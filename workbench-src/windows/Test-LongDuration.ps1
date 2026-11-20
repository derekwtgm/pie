<#
 EightMax Test Workbench 0.35.0 - long-duration hardware acceptance (RUN-LONG-ACCEPTANCE.cmd).
 Covers what the 0.30 acceptance did not establish on the target PC:
   1 hardware facts                    5 large strategy-library verification and exact quality checks
   2 self-test of the 0.31 components  6 ten-table simulation at 1/2/5/8/10 tables: cached, partially cached, range-aware,
   3 mathematical validation (quick)     quality-gated, active solving (tools\benchmark-031.cjs), with stale/duplicate checks
   4 sustained precomputation           7 continuous screen capture (Windows Graphics Capture session) for -CaptureMinutes
                                        8 memory ceiling and leftover processes; 9 GPU solver training (reported, not available in 5.1)
 Correctness checks decide pass/fail. Performance TARGETS (shared retrieval P50/P95/P99 10/25/50 ms) are reported separately in
 long-duration-targets.json as met / not met: they are development targets, not acceptance criteria.
 Results: %LOCALAPPDATA%\EightMax-Test-Workbench\LongAcceptance\<run>\ and a results ZIP on the Desktop (Collect-TestResults.ps1).
 Typical duration on an i7-13700F: 60-120 minutes with the defaults. Nothing here plays on any external site.
#>
param([string]$OutDir,[int]$Hands=40,[int]$PrecomputeMinutes=15,[int]$CaptureMinutes=20,[string]$Tables='1,2,5,8,10',[switch]$Quick,[switch]$NoCollect)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$root=Get-WorkbenchRoot
if(-not $OutDir){$OutDir=New-EmRunFolder 'LongAcceptance'}else{[IO.Directory]::CreateDirectory($OutDir)|Out-Null}
if($Quick){$Hands=4;$PrecomputeMinutes=2;$CaptureMinutes=1;$Tables='1,2'}
$report=New-EmReport 'long-duration-acceptance' $OutDir
$node=Join-Path $root 'runtime\node\node.exe'; $cli=Join-Path $root 'native\mwcli.exe'; $wgc=Join-Path $root 'desktop\bin\EightMaxWgc.exe'
$env:EIGHTMAX_TEST_CLI=$cli
$lib=Join-Path $OutDir 'library'; $env:EIGHTMAX_STRATEGY_LIBRARY=$lib
foreach($e in @('runtime\node\node.exe','native\mwcli.exe','desktop\bin\EightMaxWorkbench.exe','desktop\bin\EightMaxCapture.exe','desktop\bin\EightMaxWgc.exe')){$report.executables[$e]=Get-EmFileVersion (Join-Path $root $e)}
$targets=[ordered]@{format='eightmax-long-duration-targets';version=1;appVersion=$WorkbenchVersion;note='Development targets, not acceptance criteria.';items=@()}
# memory sampler: peak working set of this release's processes every 2 s, in a background job
$sampler=Start-Job -ArgumentList $OutDir -ScriptBlock { param($d) $peak=0; $f=Join-Path $d 'memory-samples.csv'; 'time,node_mib,mwcli_mib,total_mib,free_mib' | Out-File -Encoding ascii $f
  while($true){ $n=(Get-Process node -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum; $m=(Get-Process mwcli -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum; $os=Get-CimInstance Win32_OperatingSystem
    ('{0},{1},{2},{3},{4}' -f (Get-Date -Format 'HH:mm:ss'),[int]($n/1MB),[int]($m/1MB),[int](($n+$m)/1MB),[int]($os.FreePhysicalMemory/1KB)) | Out-File -Append -Encoding ascii $f; Start-Sleep -Seconds 2 } }
function Step([string]$Name,[string[]]$NodeArgs,[int]$Seconds){ $t=[DateTime]::UtcNow.ToString('o'); $r=Invoke-EmTool $node $NodeArgs $OutDir ($Name -replace '[^A-Za-z0-9]+','-') $Seconds; return @{r=$r;t=$t} }
Push-Location $root
$stagesCompleted=$false; $abortError=$null   # 0.33: an exception no longer yields a report that says PASS
try{
  # 1 hardware facts
  $t=[DateTime]::UtcNow.ToString('o'); try{ & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Test-Hardware.ps1') -OutputDirectory $OutDir | Out-Null; Add-EmCheck $report 'hardware facts' $(if(Test-Path (Join-Path $OutDir 'hardware-facts.json')){'pass'}else{'fail'}) 'hardware-facts.json written' 'hardware' '' '' @((Join-Path $OutDir 'hardware-facts.json')) $t }catch{ Add-EmCheck $report 'hardware facts' 'fail' $_.Exception.Message 'hardware' (Get-EmErrorClass $_) }
  # 2 self-test
  $s=Step 'self-test' @('--test','--test-concurrency=2','tests\range-engine-031.test.cjs','tests\quality-031.test.cjs','tests\library-031.test.cjs','tests\abstraction-031.test.cjs','tests\strategy-library-030.test.cjs','tests\precompute-030.test.cjs') 2400
  $failLine=([regex]::Match($s.r.stdout,'\x23 fail (\d+)')).Groups[1].Value; $passLine=([regex]::Match($s.r.stdout,'\x23 pass (\d+)')).Groups[1].Value
  Add-EmCheck $report '0.31 component self-test' $(if($s.r.exit -eq 0 -and $failLine -eq '0'){'pass'}else{'fail'}) ('pass ' + $passLine + ', fail ' + $failLine + ', exit ' + $s.r.exit + ', ' + $s.r.ms + ' ms') 'self-test' $(if($s.r.timedOut){'timeout'}else{''}) '' @($s.r.stdoutPath,$s.r.stderrPath) $s.t
  # 3 math validation (quick)
  $mv=Join-Path $OutDir 'math-validation.json'; $s=Step 'math-validation' @('tools\math-validation-031.cjs','--quick','--skip030',('--out=' + $mv)) 3600
  Add-EmCheck $report 'mathematical validation (quick, exact small games)' $(if($s.r.exit -eq 0 -and (Test-Path $mv)){'pass'}else{'fail'}) ('exit ' + $s.r.exit + ', ' + $s.r.ms + ' ms') 'math' $(if($s.r.timedOut){'timeout'}else{''}) '' @($mv,$s.r.stderrPath) $s.t
  # 4 sustained precomputation
  $s=Step 'catalog' @('tools\strategy-library.cjs','catalog','--players=2','--pot=5.3','--stacks=22.65,22.65','--limit=400') 600
  $s=Step 'precompute' @('tools\strategy-library.cjs','precompute',('--minutes=' + $PrecomputeMinutes)) (($PrecomputeMinutes + 10) * 60)
  $done=([regex]::Matches($s.r.stderr,'\x5D complete ')).Count; $failed=([regex]::Matches($s.r.stderr,'\x5D (failed|memory-limited) ')).Count
  Add-EmCheck $report ('sustained precomputation (' + $PrecomputeMinutes + ' min)') $(if($done -gt 0 -and $failed -eq 0 -and -not $s.r.timedOut){'pass'}else{'fail'}) ('studies completed ' + $done + ', failed/memory-limited ' + $failed + ', ' + [int]($s.r.ms/1000) + ' s') 'precompute' $(if($s.r.timedOut){'timeout'}else{''}) '' @($s.r.stdoutPath,$s.r.stderrPath) $s.t
  # 5 library verification + exact quality checks
  $s=Step 'verify' @('tools\strategy-library.cjs','verify') 1800; $ok=$s.r.exit -eq 0 -and $s.r.stdout -match '"damaged"\s*:\s*\[\s*\]'
  Add-EmCheck $report 'strategy library integrity (every record)' $(if($s.r.exit -eq 0){'pass'}else{'fail'}) ('exit ' + $s.r.exit + ', ' + $s.r.ms + ' ms') 'library' '' '' @($s.r.stdoutPath) $s.t
  $s=Step 'quality' @('tools\strategy-library.cjs','quality') 1800
  Add-EmCheck $report 'strategy quality evaluation' $(if($s.r.exit -eq 0){'pass'}else{'fail'}) ('exit ' + $s.r.exit + '; ' + (($s.r.stdout -replace '\s+',' ') | ForEach-Object { $_.Substring(0,[math]::Min(300,$_.Length)) })) 'quality' '' '' @($s.r.stdoutPath) $s.t
  # 6 ten-table simulation
  $bench=Join-Path $OutDir 'benchmark-031.json'; $s=Step 'benchmark' @('tools\benchmark-031.cjs',('--tables=' + $Tables),('--hands=' + $Hands),'--workers=4','--updates=2000000','--workloads=E,A,B,C,D',('--work=' + (Join-Path $OutDir 'bench-work')),('--out=' + $bench)) 14400
  if(Test-Path $bench){ $b=Get-Content $bench -Raw | ConvertFrom-Json
    foreach($T in $b.runs.PSObject.Properties){ foreach($w in $T.Value.PSObject.Properties){ if($w.Name -like 'library*'){continue}; $x=$w.Value
      $okRun=($x.handsCompleted -eq $x.handsRequested) -and ($x.staleDecisions -eq 0) -and ($x.ackMismatches -eq 0)
      Add-EmCheck $report ('simulation ' + $T.Name + ' tables, workload ' + $w.Name) $(if($okRun){'pass'}else{'fail'}) ('hands ' + $x.handsCompleted + '/' + $x.handsRequested + ', stale ' + $x.staleDecisions + ', ack mismatches ' + $x.ackMismatches + ', duplicates blocked ' + $x.duplicateActionsBlocked + ', cycle p95 ' + $x.latencyMs.endToEndCycle.p95 + ' ms, peak RSS ' + [int]($x.resources.rssBytesPeak/1MB) + ' MiB') 'simulation'
      if($x.latencyMs.sharedFetch.n -gt 0){ $targets.items+=[ordered]@{tables=$T.Name;workload=$w.Name;sharedFetchP50=$x.latencyMs.sharedFetch.p50;sharedFetchP95=$x.latencyMs.sharedFetch.p95;sharedFetchP99=$x.latencyMs.sharedFetch.p99;met=($x.latencyMs.sharedFetch.p50 -le 10 -and $x.latencyMs.sharedFetch.p95 -le 25 -and $x.latencyMs.sharedFetch.p99 -le 50)} } } } }
  else { Add-EmCheck $report 'ten-table simulation' 'fail' ('benchmark produced no report; exit ' + $s.r.exit) 'simulation' $(if($s.r.timedOut){'timeout'}else{''}) '' @($s.r.stderrPath) $s.t }
  # 7 continuous capture
  if(Test-Path $wgc){ $cap=Join-Path $OutDir 'capture-session'; [IO.Directory]::CreateDirectory($cap)|Out-Null; $t=[DateTime]::UtcNow.ToString('o')
    $r=Invoke-EmTool $wgc @('--session','--monitor','0','--out-dir',$cap,'--fps','5','--duration-ms',[string]($CaptureMinutes*60000),'--save-every','300') $OutDir 'wgc-session' ($CaptureMinutes*60+120)
    Add-EmCheck $report ('continuous Windows Graphics Capture (' + $CaptureMinutes + ' min, 5 fps)') $(if($r.exit -eq 0){'pass'}else{'fail'}) ('exit ' + $r.exit + '; ' + (($r.stdout -replace '\s+',' ') | ForEach-Object { $_.Substring([math]::Max(0,$_.Length-400)) })) 'capture' $(if($r.timedOut){'timeout'}else{''}) '' @($r.stdoutPath,$r.stderrPath) $t }
  else { Add-EmCheck $report 'continuous Windows Graphics Capture' 'fail' 'desktop\bin\EightMaxWgc.exe is missing' 'capture' 'missing-executable' }
  # 9 GPU training
  Add-EmCheck $report 'GPU-accelerated solver training' 'skip' 'Not available: the bundled EightMax 5.1 native CLI trains on the CPU only. GPU facts are recorded in hardware-facts.json.' 'gpu'
  $stagesCompleted=$true
}
catch{ $abortError=$_.Exception.Message }
finally{
  Pop-Location
  if(-not $stagesCompleted){ Add-EmCheck $report 'all acceptance stages completed' 'fail' ('The run stopped before every stage finished' + $(if($abortError){': ' + $abortError}else{''})) 'harness' 'aborted' }
  Stop-Job $sampler -ErrorAction SilentlyContinue | Out-Null; Remove-Job $sampler -Force -ErrorAction SilentlyContinue | Out-Null
  # 8 memory ceiling and leftovers
  try{ $rows=Import-Csv (Join-Path $OutDir 'memory-samples.csv'); $peak=($rows | Measure-Object total_mib -Maximum).Maximum; $minFree=($rows | Measure-Object free_mib -Minimum).Minimum; $tot=[int]((Get-CimInstance Win32_OperatingSystem).TotalVisibleMemorySize/1KB)
    Add-EmCheck $report 'memory stayed controlled' $(if($peak -lt 0.75*$tot -and $minFree -gt 1024){'pass'}else{'fail'}) ('peak workbench working set ' + $peak + ' MiB of ' + $tot + ' MiB; lowest free ' + $minFree + ' MiB') 'memory' '' '' @((Join-Path $OutDir 'memory-samples.csv')) }catch{ Add-EmCheck $report 'memory stayed controlled' 'fail' $_.Exception.Message 'memory' 'harness-error' }
  $left=@(Get-Process -Name mwcli -ErrorAction SilentlyContinue); Add-EmCheck $report 'no leftover solver processes' $(if($left.Count -eq 0){'pass'}else{'fail'}) ('mwcli processes left: ' + $left.Count) 'cleanup'
  Write-WorkbenchUtf8 (Join-Path $OutDir 'long-duration-targets.json') ($targets | ConvertTo-Json -Depth 6)
  $final=Complete-EmReport $report (Join-Path $OutDir 'long-duration-acceptance.json')
  Write-Host ''; Write-Host ('LONG-DURATION ACCEPTANCE: ' + $(if($final.passed){'PASS'}else{'FAIL'}) + ' (' + $final.counts.passed + ' passed, ' + $final.counts.failed + ' failed, ' + $final.counts.skipped + ' skipped). Results: ' + $OutDir)
  if(-not $NoCollect){ try{ & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Collect-TestResults.ps1') -NoUi | Out-Null }catch{} }
  if(-not $final.passed){ exit 1 }
}
