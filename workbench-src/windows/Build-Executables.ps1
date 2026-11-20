<# EightMax Test Workbench 0.35.0 - build the Windows executables ON WINDOWS from the shipped C# sources.
   desktop\DesktopHost.cs + CaptureService.cs + InputBroker.cs (0.35) -> EightMaxWorkbench.exe (.NET Framework 4.x C# compiler, x64, winexe)
   desktop\capture\EightMaxCapture.cs + CaptureService -> EightMaxCapture.exe   (.NET Framework 4.x C# compiler, x64, exe)
   desktop\wgc\EightMaxWgc.csproj                      -> EightMaxWgc.exe       (.NET 8 SDK, win-x64 self-contained single file)
   desktop\input\*.cs (0.35)                          -> EightMaxInput.exe     (.NET Framework 4.x C# compiler, x64, exe; /define:UIA + UI Automation; PerMonitorV2 manifest)
   desktop\testtable\EightMaxTestTable.cs (0.35)      -> EightMaxTestTable.exe (.NET Framework 4.x C# compiler, x64, winexe; PerMonitorV2 manifest)
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
if (-not (Test-Path -LiteralPath $csc)) { throw ('The .NET Framework 4.x compiler csc.exe was not found at ' + $csc) }
$refs = @('System.dll','System.Core.dll','System.Web.Extensions.dll','System.Windows.Forms.dll','System.Drawing.dll') | ForEach-Object { "/r:$(Join-Path $fw $_)" }
function Compile([string]$target, [string]$out, [string[]]$sources, [string]$main, [string[]]$extra) {
  $args2 = @('/nologo', '/langversion:5', '/platform:x64', '/optimize+', "/target:$target", "/out:$out") + $refs + $(if ($main) { @("/main:$main") } else { @() }) + $(if ($extra) { $extra } else { @() }) + $sources   # interpolation: in @(a, 'x' + y) the comma binds tighter than +
  Write-Host ('csc ' + ($args2 -join ' '))
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'   # Windows PowerShell 5.1 turns native stderr into errors under Stop
  $o = & $csc @args2 2>&1 | ForEach-Object { "$_" }; $code = $LASTEXITCODE; $ErrorActionPreference = $prev
  $o | ForEach-Object { Write-Host $_ }
  if ($code -ne 0) { throw ('csc failed for ' + $out + ' (exit ' + $code + ')') }
}
$hostOut = Join-Path $OutDir 'EightMaxWorkbench.exe'; $capOut = Join-Path $OutDir 'EightMaxCapture.exe'; $wgcOut = Join-Path $OutDir 'EightMaxWgc.exe'
Compile 'winexe' $hostOut @((Join-Path $Root 'desktop\DesktopHost.cs'), (Join-Path $Root 'desktop\CaptureService.cs'), (Join-Path $Root 'desktop\InputBroker.cs')) 'EightMax.Workbench.DesktopHost'
Compile 'exe' $capOut @((Join-Path $Root 'desktop\capture\EightMaxCapture.cs'), (Join-Path $Root 'desktop\CaptureService.cs')) $null
# 0.35.0: input driver (UI Automation assemblies live in the WPF folder of the .NET Framework) and the controlled test table
$inOut = Join-Path $OutDir 'EightMaxInput.exe'; $ttOut = Join-Path $OutDir 'EightMaxTestTable.exe'; $wpf = Join-Path $fw 'WPF'
$inputSources = @(Get-ChildItem (Join-Path $Root 'desktop\input') -Filter *.cs | Sort-Object Name | ForEach-Object { $_.FullName })
Compile 'exe' $inOut $inputSources 'EightMax.Input.Program' @('/define:UIA', "/r:$(Join-Path $wpf 'UIAutomationClient.dll')", "/r:$(Join-Path $wpf 'UIAutomationTypes.dll')", "/r:$(Join-Path $wpf 'WindowsBase.dll')", "/win32manifest:$(Join-Path $Root 'desktop\input\app.manifest')")
Compile 'winexe' $ttOut @((Join-Path $Root 'desktop\testtable\EightMaxTestTable.cs')) 'EightMax.TestTable.Program' @("/win32manifest:$(Join-Path $Root 'desktop\testtable\app.manifest')")
$prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; $cscVersion = ((& $csc /help 2>&1 | ForEach-Object { "$_" } | Select-Object -First 1) -join ' ').Trim(); $ErrorActionPreference = $prev
$dotnetVersion = $null
if (-not $SkipWgc) {
  $dotnet = Get-Command dotnet -ErrorAction SilentlyContinue; if (-not $dotnet) { throw 'The .NET 8 SDK (dotnet) is needed for the WGC helper; use -SkipWgc to keep the shipped helper.' }
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; $dotnetVersion = ((& dotnet --version 2>&1 | ForEach-Object { "$_" }) -join ' ').Trim(); $ErrorActionPreference = $prev
  $tmp = Join-Path $env:TEMP ('em-wgc-' + [guid]::NewGuid().ToString('N')); Copy-Item -Recurse (Join-Path $Root 'desktop\wgc') $tmp
  $env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'; $env:DOTNET_NOLOGO = '1'
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  & dotnet publish (Join-Path $tmp 'EightMaxWgc.csproj') -c Release -o (Join-Path $tmp 'out') -p:SelfContained=true -p:EnableCompressionInSingleFile=true 2>&1 | ForEach-Object { Write-Host "$_" }; $code = $LASTEXITCODE; $ErrorActionPreference = $prev
  if ($code -ne 0) { throw ('dotnet publish failed (exit ' + $code + ')') }
  Copy-Item -Force (Join-Path $tmp 'out\EightMaxWgc.exe') $wgcOut; Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
$os = Get-CimInstance Win32_OperatingSystem
$sha = { param($p) (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }
$outputs = [ordered]@{
  'desktop/bin/EightMaxWorkbench.exe' = [ordered]@{ sha256 = (& $sha $hostOut); compiler = $cscVersion + ' (.NET Framework 4.x, /langversion:5 /platform:x64 /optimize+)'; sources = @('desktop/DesktopHost.cs','desktop/CaptureService.cs','desktop/InputBroker.cs'); crossCompiled = $false }
  'desktop/bin/EightMaxCapture.exe' = [ordered]@{ sha256 = (& $sha $capOut); compiler = $cscVersion + ' (.NET Framework 4.x)'; sources = @('desktop/capture/EightMaxCapture.cs','desktop/CaptureService.cs'); crossCompiled = $false }
  'desktop/bin/EightMaxInput.exe' = [ordered]@{ sha256 = (& $sha $inOut); compiler = $cscVersion + ' (.NET Framework 4.x, /define:UIA, UIAutomationClient)'; sources = @($inputSources | ForEach-Object { 'desktop/input/' + (Split-Path $_ -Leaf) }); crossCompiled = $false }
  'desktop/bin/EightMaxTestTable.exe' = [ordered]@{ sha256 = (& $sha $ttOut); compiler = $cscVersion + ' (.NET Framework 4.x)'; sources = @('desktop/testtable/EightMaxTestTable.cs'); crossCompiled = $false }
}
if (-not $SkipWgc) { $outputs['desktop/bin/EightMaxWgc.exe'] = [ordered]@{ sha256 = (& $sha $wgcOut); compiler = '.NET SDK ' + $dotnetVersion + ' on Windows, win-x64 self-contained single file'; sources = @('desktop/wgc/Program.cs','desktop/wgc/SelfTest.cs','desktop/wgc/PngWriter.cs'); crossCompiled = $false } }
$ev = [ordered]@{ format = 'eightmax-build-evidence'; version = 1; builtAt = [DateTime]::UtcNow.ToString('o'); buildHost = 'Windows: ' + $os.Caption + ' ' + $os.Version + ' build ' + $os.BuildNumber; ci = [ordered]@{ runId = $env:GITHUB_RUN_ID; runner = $env:RUNNER_NAME; repository = $env:GITHUB_REPOSITORY; sha = $env:GITHUB_SHA }; outputs = $outputs }
$evDir = Join-Path $Root 'evidence'; [IO.Directory]::CreateDirectory($evDir) | Out-Null
$json = $ev | ConvertTo-Json -Depth 6; [IO.File]::WriteAllText((Join-Path $evDir 'build-evidence.json'), $json, (New-Object Text.UTF8Encoding($false)))
Write-Host $json
