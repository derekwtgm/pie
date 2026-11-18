# EightMax Test Workbench - Windows CI validation driver (GitHub Actions windows-latest). Runs in Windows PowerShell 5.1.
# Tests the EXACT candidate release ZIP: verifies its checksum, extracts it, runs RUN-RELEASE-ACCEPTANCE's script with the install
# cycle, the Node.js regression suite with the bundled runtime, and the results collector; prints every report into the log.
# A hosted runner has no GPU and a virtual display; capture results here are NOT the target PC (RTX 4060 Ti, 3840x2160 @ 150 %).
param([string]$Zip)
$ErrorActionPreference = 'Continue'
function Section($t) { Write-Host ''; Write-Host ('==== ' + $t + ' ====') }
function Show($p) { if (Test-Path -LiteralPath $p) { Write-Host ('---- ' + $p); Get-Content -LiteralPath $p -Raw | Write-Host } else { Write-Host ('(missing) ' + $p) } }
Section 'ENVIRONMENT'
$os = Get-CimInstance Win32_OperatingSystem; $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
Write-Host ('OS: ' + $os.Caption + ' ' + $os.Version + ' build ' + $os.BuildNumber)
Write-Host ('PowerShell: ' + $PSVersionTable.PSVersion + ' ' + $PSVersionTable.PSEdition)
Write-Host ('.NET Framework release: ' + (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full').Release)
Write-Host ('CPU: ' + $cpu.Name + ' cores ' + $cpu.NumberOfCores + ' logical ' + $cpu.NumberOfLogicalProcessors + '; RAM total ' + [math]::Round($os.TotalVisibleMemorySize/1MB,1) + ' GiB free ' + [math]::Round($os.FreePhysicalMemory/1MB,1) + ' GiB')
Write-Host ('GPU: ' + ((Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name + ' ' + $_.CurrentHorizontalResolution + 'x' + $_.CurrentVerticalResolution }) -join '; '))
Write-Host ('UserInteractive: ' + [Environment]::UserInteractive + '; session: ' + (Get-Process -Id $PID).SessionId + '; user: ' + $env:USERNAME)
try { Write-Host ('Loopback proxy bypassed: ' + ([Net.WebRequest]::DefaultWebProxy.IsBypassed([Uri]'http://127.0.0.1:48713/'))) } catch {}
Section 'CANDIDATE'
$expected = (Get-Content ($Zip + '.sha256') -TotalCount 1).Split(' ')[0].Trim().ToLowerInvariant(); $actual = (Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host ('zip sha256 ' + $actual + ' expected ' + $expected + ' -> ' + $(if ($actual -eq $expected) { 'MATCH' } else { 'MISMATCH' }))
if ($actual -ne $expected) { exit 2 }
$work = 'C:\em'; Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue; New-Item -ItemType Directory $work | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory((Resolve-Path $Zip).Path, $work)
$root = Join-Path $work 'EightMax-Test-Workbench'; Get-ChildItem $root | Select-Object -First 40 Name | Format-Table -HideTableHeaders | Out-String | Write-Host
foreach ($e in 'desktop\bin\EightMaxWorkbench.exe','desktop\bin\EightMaxCapture.exe','desktop\bin\EightMaxWgc.exe','native\mwcli.exe','runtime\node\node.exe') { $v = (Get-Item (Join-Path $root $e)).VersionInfo; Write-Host ($e + ': ProductVersion=' + $v.ProductVersion + ' FileVersion=' + $v.FileVersion) }
Section 'EXECUTABLE SMOKE'
& (Join-Path $root 'desktop\bin\EightMaxCapture.exe') version; Write-Host ('exit ' + $LASTEXITCODE)
& (Join-Path $root 'desktop\bin\EightMaxWgc.exe') --version; Write-Host ('exit ' + $LASTEXITCODE)
& (Join-Path $root 'desktop\bin\EightMaxWgc.exe') --probe; Write-Host ('exit ' + $LASTEXITCODE)
& (Join-Path $root 'runtime\node\node.exe') --version; Write-Host ('exit ' + $LASTEXITCODE)
& (Join-Path $root 'native\mwcli.exe') --build-id; Write-Host ('exit ' + $LASTEXITCODE)
Section 'RELEASE ACCEPTANCE (windows\Test-Release.ps1 -IncludeInstall)'
$out = 'C:\em-results\release'; $env:EIGHTMAX_NO_EXPLORER = '1'
$sw = [Diagnostics.Stopwatch]::StartNew()
& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File (Join-Path $root 'windows\Test-Release.ps1') -OutDir $out -IncludeInstall -NoCollect
Write-Host ('Test-Release exit ' + $LASTEXITCODE + ' after ' + [int]$sw.Elapsed.TotalSeconds + ' s')
Show (Join-Path $out 'critical-acceptance.json'); Show (Join-Path $out 'release-acceptance.json')
foreach ($f in Get-ChildItem $out -Recurse -File -Include *.json,*.log,*.txt -ErrorAction SilentlyContinue | Where-Object { $_.Length -lt 200000 -and $_.Name -notin @('critical-acceptance.json','release-acceptance.json') -and $_.Name -notlike '*.png' }) { Show $f.FullName }
$logs = Join-Path $env:LOCALAPPDATA 'EightMax-Test-Workbench\Logs'; Get-ChildItem $logs -File -ErrorAction SilentlyContinue | ForEach-Object { Show $_.FullName }
Section 'NATIVE JOB FILES'
Get-ChildItem (Join-Path $env:LOCALAPPDATA 'EightMax-Test-Workbench\NativeJobs') -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Length -lt 20000 -and $_.Extension -in '.txt','.log','.json' } | Select-Object -First 25 | ForEach-Object { Show $_.FullName }
Section 'LEFTOVER PROCESSES'
Get-Process -Name mwcli,EightMaxWorkbench,EightMaxCapture,EightMaxWgc -ErrorAction SilentlyContinue | Format-Table Id,ProcessName,StartTime | Out-String | Write-Host
Section 'NODE REGRESSION SUITE (bundled runtime\node\node.exe, Windows)'
Push-Location $root
$files = (Get-ChildItem tests -Filter *.test.cjs | ForEach-Object { 'tests\' + $_.Name })
$env:EIGHTMAX_TEST_CLI = Join-Path $root 'native\mwcli.exe'
& (Join-Path $root 'runtime\node\node.exe') --test --test-concurrency=2 @files 2>&1 | Tee-Object -FilePath 'C:\em-results\node-tests.txt' | Select-String -Pattern '^(not ok|# (tests|pass|fail|skipped|cancelled))' | ForEach-Object { Write-Host $_.Line }
Pop-Location
Select-String -Path 'C:\em-results\node-tests.txt' -Pattern '^not ok' -Context 0,25 | Select-Object -First 30 | ForEach-Object { Write-Host ($_.Line); $_.Context.PostContext | Where-Object { $_ -match 'error|expected|actual|Error' } | Select-Object -First 6 | ForEach-Object { Write-Host ('    ' + $_) } }
Section 'RESULTS COLLECTOR'
$roots = @('C:\em-results\release') + (@('ReleaseAcceptance','Diagnostics','CaptureAcceptance','WgcAcceptance','Reports','Logs') | ForEach-Object { Join-Path $env:LOCALAPPDATA ('EightMax-Test-Workbench\' + $_) }) + (Join-Path $root 'reports')
& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'windows\Collect-TestResults.ps1') -NoUi -Destination 'C:\em-results\zip' -SearchRoot ($roots -join ',')
$z = Get-ChildItem 'C:\em-results\zip' -Filter 'EightMax-Windows-Test-Results-*.zip' | Select-Object -First 1
if ($z) { $t = Join-Path $env:TEMP 'collect'; [IO.Compression.ZipFile]::ExtractToDirectory($z.FullName, $t); Show (Join-Path $t 'README-RESULTS.txt') }
exit 0
