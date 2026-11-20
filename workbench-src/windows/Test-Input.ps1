# EightMax Test Workbench 0.35.0 - Simulator Controls acceptance for this PC (RUN-035-ACCEPTANCE.cmd).
# 1. input driver self-test (its own window), 2. input acceptance on the controlled test tables, 3. the end-to-end multi-table
# benchmark. Results go to %LOCALAPPDATA%\EightMax-Test-Workbench\Acceptance-0.35 (collected by COLLECT-TEST-RESULTS.cmd).
param([switch]$Quick, [string]$OutDir)
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'Common.ps1')
$root = Get-WorkbenchRoot
if (-not $OutDir) { $OutDir = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'EightMax-Test-Workbench\Acceptance-0.35' }
New-Item -ItemType Directory -Force $OutDir | Out-Null
$node = Join-Path $root 'runtime\node\node.exe'; $steps = [ordered]@{}
Add-Type -AssemblyName System.Windows.Forms
$screens = [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { [ordered]@{ name = $_.DeviceName; bounds = "$($_.Bounds)"; primary = $_.Primary } }
Write-Host 'EightMax 0.35 Simulator Controls acceptance. The cursor will move by itself - please do not touch the mouse or keyboard.'
Write-Host ('Displays: ' + (($screens | ForEach-Object { $_.name + ' ' + $_.bounds }) -join '; '))
if (Get-Process -Name EightMaxWorkbench -ErrorAction SilentlyContinue) { Write-Host 'Close the EightMax desktop host first (the benchmark starts its own).'; exit 2 }
Write-Host '1/3 input driver self-test'; & (Join-Path $root 'desktop\bin\EightMaxInput.exe') --selftest --out (Join-Path $OutDir 'input-selftest.json') | Out-Null; $steps['input-selftest'] = $LASTEXITCODE
Write-Host '2/3 input acceptance (controlled test tables)'; Push-Location $root; & $node tools\input-acceptance-035.cjs --out (Join-Path $OutDir 'input-acceptance.json') --oracle-dir (Join-Path $OutDir 'oracle'); $steps['input-acceptance'] = $LASTEXITCODE; Pop-Location
$benchArgs = @('tools\simulator-benchmark-035.cjs', '--out', (Join-Path $OutDir 'simulator-benchmark.json'), '--work', (Join-Path $OutDir 'benchmark-work')); if ($Quick) { $benchArgs += @('--tables', '1,2', '--seconds', '40') }
Write-Host '3/3 end-to-end multi-table benchmark'; Push-Location $root; & $node @benchArgs; $steps['simulator-benchmark'] = $LASTEXITCODE; Pop-Location
$summary = [ordered]@{ format = 'eightmax-input-acceptance-summary'; version = 1; appVersion = '0.35.0'; at = [DateTime]::UtcNow.ToString('o'); displays = $screens; exitCodes = $steps; passed = (@($steps.Values | Where-Object { $_ -ne 0 }).Count -eq 0) }
[IO.File]::WriteAllText((Join-Path $OutDir 'acceptance-0.35-summary.json'), ($summary | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
Write-Host ('Result: ' + $(if ($summary.passed) { 'PASSED' } else { 'NOT PASSED - see ' + $OutDir })); Write-Host 'Next: COLLECT-TEST-RESULTS.cmd'
if ($summary.passed) { exit 0 } else { exit 1 }
