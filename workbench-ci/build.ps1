# EightMax Test Workbench 0.33 - Windows CI BUILD stage: compile the host, capture tool and WGC helper ON WINDOWS from workbench-src,
# run their smoke tests (version, monitor probe, WGC self-test, capture self-test), and keep the executables + log as evidence.
$ErrorActionPreference = 'Continue'
$out = 'C:\em-build'; Remove-Item -Recurse -Force $out -ErrorAction SilentlyContinue; New-Item -ItemType Directory $out | Out-Null
Start-Transcript -Path (Join-Path $out 'build-log.txt') | Out-Null
$os = Get-CimInstance Win32_OperatingSystem; $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
Write-Host ('OS: ' + $os.Caption + ' ' + $os.Version + ' build ' + $os.BuildNumber + '; CPU: ' + $cpu.Name + '; RAM ' + [math]::Round($os.TotalVisibleMemorySize/1MB,1) + ' GiB')
Write-Host ('GPU: ' + ((Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }) -join '; '))
$src = (Resolve-Path 'workbench-src').Path; $bin = Join-Path $out 'bin'
$buildExit = 0
try { & (Join-Path $src 'windows\Build-Executables.ps1') -Root $src -OutDir $bin } catch { $buildExit = 1; Write-Host ('BUILD FAILED: ' + $_.Exception.Message); Write-Host $_.ScriptStackTrace }
$ErrorActionPreference = 'Continue'; Write-Host ('Build-Executables result ' + $buildExit)
Copy-Item (Join-Path $src 'evidence\build-evidence.json') $out -ErrorAction SilentlyContinue
$smoke = [ordered]@{}
function Probe($name, $exe, $argv) { $o = & $exe @argv 2>&1 | Out-String; $code = $LASTEXITCODE; Write-Host ('---- ' + $name + ' exit ' + $code); Write-Host $o; $smoke[$name] = [ordered]@{ exit = $code; output = $o.Trim().Substring(0, [math]::Min(2000, $o.Trim().Length)) } }
if ($buildExit -eq 0) {
  Probe 'capture version' (Join-Path $bin 'EightMaxCapture.exe') @('version')
  Probe 'capture list-monitors' (Join-Path $bin 'EightMaxCapture.exe') @('list-monitors')
  Probe 'capture selftest' (Join-Path $bin 'EightMaxCapture.exe') @('selftest')
  Probe 'wgc version' (Join-Path $bin 'EightMaxWgc.exe') @('--version')
  Probe 'wgc probe' (Join-Path $bin 'EightMaxWgc.exe') @('--probe')
  Probe 'wgc selftest' (Join-Path $bin 'EightMaxWgc.exe') @('--selftest','--out-dir',(Join-Path $out 'wgc-selftest'))
  foreach ($e in 'EightMaxWorkbench.exe','EightMaxCapture.exe','EightMaxWgc.exe') { $p = Join-Path $bin $e; $v = (Get-Item $p).VersionInfo; $smoke['file ' + $e] = [ordered]@{ productVersion = $v.ProductVersion; fileVersion = $v.FileVersion; bytes = (Get-Item $p).Length; sha256 = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() } }
}
$doc = [ordered]@{ format = 'eightmax-ci-build'; version = 1; runId = $env:GITHUB_RUN_ID; sha = $env:GITHUB_SHA; os = $os.Caption + ' ' + $os.Version + ' build ' + $os.BuildNumber; buildExit = $buildExit; smoke = $smoke }
[IO.File]::WriteAllText((Join-Path $out 'build-smoke.json'), ($doc | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
Stop-Transcript | Out-Null
exit 0
