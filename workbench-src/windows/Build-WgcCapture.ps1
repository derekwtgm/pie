<# EightMax Test Workbench 0.35.0 - rebuild the Windows Graphics Capture helper (desktop\wgc) into desktop\bin\EightMaxWgc.exe.
   A prebuilt helper already ships in desktop\bin (cross-compiled on Linux for 0.35.0). Rebuild only to verify it from source.
   Needs the .NET 8 SDK on THIS machine once; the produced exe is self-contained (running it needs no .NET install).
   Rebuilding changes the exe hash, so SHA256SUMS.txt will no longer match it: RUN-RELEASE-ACCEPTANCE reports that honestly. #>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $dotnet) { Write-Host 'The .NET 8 SDK is required to BUILD the capture helper (https://dotnet.microsoft.com/download/dotnet/8.0). It is not needed to run the workbench; a prebuilt helper ships in desktop\bin.' -ForegroundColor Yellow; exit 2 }
$out = Join-Path $root 'desktop\bin'
& dotnet publish (Join-Path $root 'desktop\wgc\EightMaxWgc.csproj') -c Release -o $out -p:EnableWindowsTargeting=true -p:SelfContained=true -p:EnableCompressionInSingleFile=true
if ($LASTEXITCODE -ne 0) { Write-Host 'Build failed; please send the compiler messages.' -ForegroundColor Red; exit $LASTEXITCODE }
Remove-Item -LiteralPath (Join-Path $out 'EightMaxWgc.pdb') -ErrorAction SilentlyContinue
Write-Host "Built $out\EightMaxWgc.exe. Now run RUN-WGC-CHECK.cmd." -ForegroundColor Green
