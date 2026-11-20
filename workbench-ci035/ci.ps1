# EightMax Test Workbench 0.35.0 - Windows CI: build the executables ON WINDOWS, then run the input-automation acceptance with
# REAL SendInput on the runner's desktop, the regression suites and the multi-table benchmark. Windows PowerShell 5.1.
# GitHub-hosted runner: Windows Server, no GPU, a virtual display - NOT the target PC (Windows 11, 3840x2160 at 150 %).
param([string]$Stage = 'all')
$ErrorActionPreference = 'Continue'
$res = 'C:\em035-results'; Remove-Item -Recurse -Force $res -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Force $res | Out-Null
Start-Transcript -Path (Join-Path $res 'ci-log.txt') -Force | Out-Null
function Section($t) { Write-Host ''; Write-Host ('==== ' + $t + ' ====') }
function Show($p) { if (Test-Path -LiteralPath $p) { Write-Host ('---- ' + $p); Get-Content -LiteralPath $p -Raw | Write-Host } else { Write-Host ('(missing) ' + $p) } }
$summary = [ordered]@{ format = 'eightmax-ci-035'; version = 1; runId = $env:GITHUB_RUN_ID; sha = $env:GITHUB_SHA; stages = [ordered]@{} }
function Stage($name, $code, $extra) { $summary.stages[$name] = [ordered]@{ exit = $code; detail = $extra }; Write-Host ('STAGE ' + $name + ' exit ' + $code) }
Section 'ENVIRONMENT'
$os = Get-CimInstance Win32_OperatingSystem; $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
Write-Host ('OS: ' + $os.Caption + ' ' + $os.Version + ' build ' + $os.BuildNumber + '; CPU: ' + $cpu.Name + ' (' + $cpu.NumberOfLogicalProcessors + ' logical); RAM ' + [math]::Round($os.TotalVisibleMemorySize/1MB,1) + ' GiB')
Write-Host ('GPU/display: ' + ((Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name + ' ' + $_.CurrentHorizontalResolution + 'x' + $_.CurrentVerticalResolution }) -join '; '))
Write-Host ('UserInteractive: ' + [Environment]::UserInteractive + '; session: ' + (Get-Process -Id $PID).SessionId + '; user: ' + $env:USERNAME)
$summary.environment = [ordered]@{ os = $os.Caption + ' ' + $os.Version; cpu = $cpu.Name; logical = $cpu.NumberOfLogicalProcessors; ramGiB = [math]::Round($os.TotalVisibleMemorySize/1MB,1); session = (Get-Process -Id $PID).SessionId; interactive = [Environment]::UserInteractive }
Section 'DISPLAY RESOLUTION'
Add-Type -AssemblyName System.Windows.Forms
$before = [System.Windows.Forms.SystemInformation]::VirtualScreen; Write-Host ('virtual screen before: ' + $before)
try { Set-DisplayResolution -Width 1920 -Height 1080 -Force -ErrorAction Stop; Write-Host 'Set-DisplayResolution 1920x1080 done' } catch { Write-Host ('Set-DisplayResolution unavailable/failed: ' + $_.Exception.Message) }
Start-Sleep -Seconds 2; $after = [System.Windows.Forms.SystemInformation]::VirtualScreen; Write-Host ('virtual screen after: ' + $after)
$summary.display = [ordered]@{ before = "$before"; after = "$after" }
Section 'BASE 0.33.0 ZIP'
$work = 'C:\em035'; Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue; New-Item -ItemType Directory $work | Out-Null
git fetch --quiet --depth 1 origin claude/workbench-0.33.0-release 2>&1 | Write-Host
cmd /c "git show FETCH_HEAD:releases/EightMax-Test-Workbench-0.33.0.zip > C:\em035\base.zip"
$h = (Get-FileHash C:\em035\base.zip -Algorithm SHA256).Hash.ToLowerInvariant(); Write-Host ('base sha256 ' + $h)
if ($h -ne '024614aa4506633b824576fc515c0b39cfd6d3bfcebb9eb483e5d170fdf2bd78') { Write-Host 'BASE ZIP MISMATCH'; Stage 'base' 2 $h; Stop-Transcript | Out-Null; exit 0 }
Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory('C:\em035\base.zip', 'C:\em035\x')
$root = 'C:\em035\x\EightMax-Test-Workbench'; robocopy (Resolve-Path 'workbench-src').Path $root /E /NFL /NDL /NJH /NJS /NP | Out-Null; Write-Host ('overlay robocopy exit ' + $LASTEXITCODE)
Stage 'base' 0 $h
Section 'BUILD ON WINDOWS'
$buildExit = 0; try { & (Join-Path $root 'windows\Build-Executables.ps1') -Root $root -OutDir (Join-Path $root 'desktop\bin') } catch { $buildExit = 1; Write-Host ('BUILD FAILED: ' + $_.Exception.Message) }
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force (Join-Path $res 'bin') | Out-Null
foreach ($e in 'EightMaxWorkbench.exe','EightMaxCapture.exe','EightMaxWgc.exe','EightMaxInput.exe','EightMaxTestTable.exe') { $p = Join-Path $root ('desktop\bin\' + $e); if (Test-Path $p) { Copy-Item $p (Join-Path $res 'bin'); Write-Host ($e + ' ' + (Get-Item $p).VersionInfo.ProductVersion + ' ' + (Get-FileHash $p -Algorithm SHA256).Hash.ToLowerInvariant()) } }
Copy-Item (Join-Path $root 'evidence\build-evidence.json') $res -ErrorAction SilentlyContinue
Stage 'build' $buildExit $null
if ($buildExit -ne 0) { $summary | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $res 'ci-summary.json'); Stop-Transcript | Out-Null; exit 0 }
$node = Join-Path $root 'runtime\node\node.exe'; $env:EIGHTMAX_TEST_CLI = Join-Path $root 'native\mwcli.exe'
Section 'INPUT DRIVER SELF-TEST (real SendInput into the driver''s own form)'
& (Join-Path $root 'desktop\bin\EightMaxInput.exe') --version
& (Join-Path $root 'desktop\bin\EightMaxInput.exe') --selftest --out (Join-Path $res 'input-selftest.json'); Stage 'input-selftest' $LASTEXITCODE $null
Show (Join-Path $res 'input-selftest.json')
Section 'NODE TESTS: 0.35 input tests'
Push-Location $root
& $node --test --test-concurrency=1 (Get-ChildItem tests -Filter '*-035.test.cjs' | ForEach-Object { $_.FullName }) 2>&1 | Tee-Object -FilePath (Join-Path $res 'node-tests-035.txt') | Select-Object -Last 40 | Write-Host; Stage 'node-tests-035' $LASTEXITCODE $null
Pop-Location
Section 'INPUT ACCEPTANCE (real cursor, controlled test tables)'
Push-Location $root
& $node tools\input-acceptance-035.cjs --out (Join-Path $res 'input-acceptance.json') --oracle-dir (Join-Path $res 'oracle') 2>&1 | Write-Host; Stage 'input-acceptance' $LASTEXITCODE $null
Pop-Location
if (Test-Path (Join-Path $root 'tools\simulator-benchmark-035.cjs')) {
  Section 'END-TO-END: capture -> recognition -> decision -> input -> confirmation, 1/2/5/8/10 tables'
  Push-Location $root
  & $node tools\simulator-benchmark-035.cjs --out (Join-Path $res 'simulator-benchmark.json') --work (Join-Path $res 'bench') 2>&1 | Write-Host; Stage 'simulator-benchmark' $LASTEXITCODE $null
  Pop-Location
}
if ($Stage -eq 'all' -or $Stage -eq 'release') {
  Section 'FULL NODE REGRESSION SUITE (bundled runtime)'
  Push-Location $root
  & $node --test --test-concurrency=2 (Get-ChildItem tests -Filter '*.test.cjs' | ForEach-Object { $_.FullName }) 2>&1 | Out-File -Encoding utf8 (Join-Path $res 'node-tests-all.txt'); Stage 'node-tests-all' $LASTEXITCODE $null
  Get-Content (Join-Path $res 'node-tests-all.txt') -Tail 12 | Write-Host
  Select-String -Path (Join-Path $res 'node-tests-all.txt') -Pattern '^not ok' | ForEach-Object { Write-Host $_.Line }
  Pop-Location
}
Section 'LEFTOVER PROCESSES'
Get-Process -Name EightMaxInput,EightMaxTestTable,EightMaxWorkbench -ErrorAction SilentlyContinue | Format-Table Id,ProcessName | Out-String | Write-Host
$summary | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 (Join-Path $res 'ci-summary.json')
Stop-Transcript | Out-Null
exit 0
