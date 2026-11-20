# EightMax Test Workbench 0.35.0 - Windows CI: validate the EXACT release ZIP (no rebuild). Verifies the checksum, extracts it, runs
# the input self-test, the input acceptance, the end-to-end benchmark, the release acceptance and the whole Node suite with the
# bundled runtime. Hosted runner (Windows Server, no GPU, virtual display) - NOT the target PC.
param([string]$Zip)
$ErrorActionPreference = 'Continue'
$res = 'C:\em035-results'; Remove-Item -Recurse -Force $res -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Force $res | Out-Null
Start-Transcript -Path (Join-Path $res 'ci-log.txt') -Force | Out-Null
function Section($t) { Write-Host ''; Write-Host ('==== ' + $t + ' ====') }
$summary = [ordered]@{ format = 'eightmax-ci-035-validate'; version = 1; runId = $env:GITHUB_RUN_ID; sha = $env:GITHUB_SHA; stages = [ordered]@{} }
function Stage($name, $code) { $summary.stages[$name] = $code; Write-Host ('STAGE ' + $name + ' exit ' + $code) }
$os = Get-CimInstance Win32_OperatingSystem; Write-Host ('OS: ' + $os.Caption + ' ' + $os.Version)
Add-Type -AssemblyName System.Windows.Forms; try { Set-DisplayResolution -Width 1920 -Height 1080 -Force -ErrorAction Stop } catch { Write-Host ('Set-DisplayResolution: ' + $_.Exception.Message) }
Start-Sleep 2; Write-Host ('virtual screen: ' + [System.Windows.Forms.SystemInformation]::VirtualScreen)
Section 'CANDIDATE'
$expected = (Get-Content ($Zip + '.sha256') -TotalCount 1).Split(' ')[0].Trim().ToLowerInvariant(); $actual = (Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host ('zip sha256 ' + $actual + ' expected ' + $expected + ' -> ' + $(if ($actual -eq $expected) { 'MATCH' } else { 'MISMATCH' })); $summary.zipSha256 = $actual; $summary.checksumMatch = ($actual -eq $expected)
if ($actual -ne $expected) { Stage 'checksum' 2; $summary | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $res 'ci-summary.json'); Stop-Transcript | Out-Null; exit 0 }
$work = 'C:\em035v'; Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue; New-Item -ItemType Directory $work | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory((Resolve-Path $Zip).Path, $work)
$root = Join-Path $work 'EightMax-Test-Workbench'; $node = Join-Path $root 'runtime\node\node.exe'; $env:EIGHTMAX_TEST_CLI = Join-Path $root 'native\mwcli.exe'
$exes = [ordered]@{}; foreach ($e in 'desktop\bin\EightMaxWorkbench.exe','desktop\bin\EightMaxCapture.exe','desktop\bin\EightMaxWgc.exe','desktop\bin\EightMaxInput.exe','desktop\bin\EightMaxTestTable.exe','native\mwcli.exe','runtime\node\node.exe') { $p = Join-Path $root $e; $exes[$e.Replace('\','/')] = (Get-FileHash $p -Algorithm SHA256).Hash.ToLowerInvariant(); Write-Host ($e + ' ' + (Get-Item $p).VersionInfo.ProductVersion + ' ' + $exes[$e.Replace('\','/')]) }
$summary.executables = $exes
Push-Location $root
Section 'MANIFEST'; $bad = 0; foreach ($line in [IO.File]::ReadAllLines((Join-Path $root 'SHA256SUMS.txt'))) { if ($line.Length -lt 67) { continue }; $f = Join-Path $root $line.Substring(66); if (-not (Test-Path -LiteralPath $f) -or (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLowerInvariant() -ne $line.Substring(0,64)) { $bad++ } }; Write-Host ('manifest mismatches: ' + $bad); Stage 'manifest' $bad
Section 'INPUT SELF-TEST'; & (Join-Path $root 'desktop\bin\EightMaxInput.exe') --selftest --out (Join-Path $res 'input-selftest.json') | Out-Null; Stage 'input-selftest' $LASTEXITCODE
Section 'INPUT ACCEPTANCE'; & $node tools\input-acceptance-035.cjs --out (Join-Path $res 'input-acceptance.json') --oracle-dir (Join-Path $res 'oracle') 2>&1 | Write-Host; Stage 'input-acceptance' $LASTEXITCODE
Section 'SIMULATOR BENCHMARK'; & $node tools\simulator-benchmark-035.cjs --out (Join-Path $res 'simulator-benchmark.json') --work (Join-Path $res 'bench') 2>&1 | Write-Host; Stage 'simulator-benchmark' $LASTEXITCODE
Pop-Location
Section 'RELEASE ACCEPTANCE (windows\Test-Release.ps1 -IncludeInstall)'
$env:EIGHTMAX_NO_EXPLORER = '1'; & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File (Join-Path $root 'windows\Test-Release.ps1') -OutDir (Join-Path $res 'release') -IncludeInstall -NoCollect; Stage 'release-acceptance' $LASTEXITCODE
Get-ChildItem (Join-Path $res 'release') -Recurse -File -Include *.png -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
Section 'NODE SUITE (bundled runtime)'
Push-Location $root
& $node --test --test-concurrency=2 (Get-ChildItem tests -Filter '*.test.cjs' | ForEach-Object { $_.FullName }) 2>&1 | Out-File -Encoding utf8 (Join-Path $res 'node-tests-all.txt'); Stage 'node-tests-all' $LASTEXITCODE
Get-Content (Join-Path $res 'node-tests-all.txt') -Tail 12 | Write-Host; Select-String -Path (Join-Path $res 'node-tests-all.txt') -Pattern '^not ok' | ForEach-Object { Write-Host $_.Line }
Pop-Location
Get-Process -Name EightMaxInput,EightMaxTestTable,EightMaxWorkbench,mwcli -ErrorAction SilentlyContinue | Format-Table Id,ProcessName | Out-String | Write-Host
$summary | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 (Join-Path $res 'ci-summary.json'); Stop-Transcript | Out-Null; exit 0
