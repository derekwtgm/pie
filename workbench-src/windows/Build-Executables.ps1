<# EightMax Test Workbench 0.33.0 - build the Windows executables ON WINDOWS from the shipped C# sources.
   desktop\DesktopHost.cs + desktop\CaptureService.cs  -> EightMaxWorkbench.exe (.NET Framework 4.x C# compiler, x64, winexe)
   desktop\capture\EightMaxCapture.cs + CaptureService -> EightMaxCapture.exe   (.NET Framework 4.x C# compiler, x64, exe)
   desktop\wgc\EightMaxWgc.csproj                      -> EightMaxWgc.exe       (.NET 8 SDK, win-x64 self-contained single file)
   Writes evidence\build-evidence.json from what actually happened (compiler, OS, hashes). Used by the 0.33 Windows CI build stage;
   you can also run it yourself (needs the .NET 8 SDK only for the WGC helper; -SkipWgc keeps the shipped helper).
   Usage: powershell -ExecutionPolicy Bypass -File windows\Build-Executables.ps1 [-Root DIR] [-OutDir DIR] [-SkipWgc] #>
param([string]$Root, [string]$OutDir, [switch]$SkipWgc)
$ErrorActionPreference = 'Stop'
if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
if (-not $OutDir) { $OutDir = Join-Path $Root 'desktop\bin' }
[IO.Directory]::CreateDirectory($OutDir) | Out-Null
$fw = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$csc = Join-Path $fw 'csc.exe'
if (-not (Test-Path -LiteralPath $csc)) { throw 'The .NET Framework 4.x C# compiler was not found at ' + $csc }
$refs = @('System.dll','System.Core.dll','System.Web.Extensions.dll','System.Windows.Forms.dll','System.Drawing.dll') | ForEach-Object { '/r:' + (Join-Path $fw $_) }
function Compile([string]$target, [string]$out, [string[]]$sources, [string]$main) {
  $args2 = @('/nologo','/langversion:5','/platform:x64','/optimize+','/target:' + $target,'/out:' + $out) + $refs + $(if ($main) { @('/main:' + $main) } else { @() }) + $sources
  $o = & $csc @args2 2>&1; $o | ForEach-Object { Write-Host $_ }
  if ($LASTEXITCODE -ne 0) { throw ('csc failed for ' + $out + ' (exit ' + $LASTEXITCODE + ')') }
}
$hostOut = Join-Path $OutDir 'EightMaxWorkbench.exe'; $capOut = Join-Path $OutDir 'EightMaxCapture.exe'; $wgcOut = Join-Path $OutDir 'EightMaxWgc.exe'
Compile 'winexe' $hostOut @((Join-Path $Root 'desktop\DesktopHost.cs'), (Join-Path $Root 'desktop\CaptureService.cs')) 'EightMax.Workbench.DesktopHost'
Compile 'exe' $capOut @((Join-Path $Root 'desktop\capture\EightMaxCapture.cs'), (Join-Path $Root 'desktop\CaptureService.cs')) $null
$cscVersion = ((& $csc /help 2>&1 | Select-Object -First 1) -join ' ').Trim()
$dotnetVersion = $null
if (-not $SkipWgc) {
  $dotnet = Get-Command dotnet -ErrorAction SilentlyContinue; if (-not $dotnet) { throw 'The .NET 8 SDK (dotnet) is needed for the WGC helper; use -SkipWgc to keep the shipped helper.' }
  $dotnetVersion = (& dotnet --version).Trim()
  $tmp = Join-Path $env:TEMP ('em-wgc-' + [guid]::NewGuid().ToString('N')); Copy-Item -Recurse (Join-Path $Root 'desktop\wgc') $tmp
  $env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'; $env:DOTNET_NOLOGO = '1'
  & dotnet publish (Join-Path $tmp 'EightMaxWgc.csproj') -c Release -o (Join-Path $tmp 'out') -p:SelfContained=true -p:EnableCompressionInSingleFile=true 2>&1 | ForEach-Object { Write-Host $_ }
  if ($LASTEXITCODE -ne 0) { throw ('dotnet publish failed (exit ' + $LASTEXITCODE + ')') }
  Copy-Item -Force (Join-Path $tmp 'out\EightMaxWgc.exe') $wgcOut; Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
$os = Get-CimInstance Win32_OperatingSystem
$sha = { param($p) (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }
$outputs = [ordered]@{
  'desktop/bin/EightMaxWorkbench.exe' = [ordered]@{ sha256 = (& $sha $hostOut); compiler = $cscVersion + ' (.NET Framework 4.x, /langversion:5 /platform:x64 /optimize+)'; sources = @('desktop/DesktopHost.cs','desktop/CaptureService.cs'); crossCompiled = $false }
  'desktop/bin/EightMaxCapture.exe' = [ordered]@{ sha256 = (& $sha $capOut); compiler = $cscVersion + ' (.NET Framework 4.x)'; sources = @('desktop/capture/EightMaxCapture.cs','desktop/CaptureService.cs'); crossCompiled = $false }
}
if (-not $SkipWgc) { $outputs['desktop/bin/EightMaxWgc.exe'] = [ordered]@{ sha256 = (& $sha $wgcOut); compiler = '.NET SDK ' + $dotnetVersion + ' on Windows, win-x64 self-contained single file'; sources = @('desktop/wgc/Program.cs','desktop/wgc/SelfTest.cs','desktop/wgc/PngWriter.cs'); crossCompiled = $false } }
$ev = [ordered]@{ format = 'eightmax-build-evidence'; version = 1; builtAt = [DateTime]::UtcNow.ToString('o'); buildHost = 'Windows: ' + $os.Caption + ' ' + $os.Version + ' build ' + $os.BuildNumber; ci = [ordered]@{ runId = $env:GITHUB_RUN_ID; runner = $env:RUNNER_NAME; repository = $env:GITHUB_REPOSITORY; sha = $env:GITHUB_SHA }; outputs = $outputs }
$evDir = Join-Path $Root 'evidence'; [IO.Directory]::CreateDirectory($evDir) | Out-Null
$json = $ev | ConvertTo-Json -Depth 6; [IO.File]::WriteAllText((Join-Path $evDir 'build-evidence.json'), $json, (New-Object Text.UTF8Encoding($false)))
Write-Host $json
