# Windows PowerShell 5.1 helpers. No downloaded modules or administrator changes.
$ExpectedEightMaxBuild = '7d08acc7eb4577ee'
$ExpectedEightMaxHash = 'b3e675bfe2ae231e7d637de07886af6b511905d5225db96fe12ce2c3ccab2f72'
function Write-WorkbenchUtf8([string]$Path, [string]$Text) {
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}
function Quote-WorkbenchPath([string]$Value) {
    if ($Value.Contains('"') -or $Value.EndsWith('\')) { throw 'Unsupported generated file path' }
    return '"' + $Value + '"'
}
function Get-WorkbenchInteger($Value, [int]$Minimum, [int]$Maximum, [string]$Name) {
    if ($null -eq $Value -or $Value -is [bool] -or $Value -is [string]) { throw "Invalid $Name" }
    $n = [double]$Value
    if ([double]::IsNaN($n) -or [double]::IsInfinity($n) -or $n -ne [math]::Floor($n) -or $n -lt $Minimum -or $n -gt $Maximum) { throw "Invalid $Name" }
    return [int]$n
}
function Get-WorkbenchRoot { return [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')) }
function Get-WorkbenchHashFailures([string]$Root) {
    $manifest = Join-Path $Root 'SHA256SUMS.txt'
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { return @('SHA256SUMS.txt missing; extract the complete ZIP') }
    $failures = New-Object Collections.Generic.List[string]
    $entries = 0
    $prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    foreach ($line in [IO.File]::ReadAllLines($manifest)) {
        if ($line -notmatch '^([a-f0-9]{64})  (.+)$') { $failures.Add('Malformed checksum entry'); continue }
        $hash = $Matches[1]; $relative = $Matches[2]; $entries++
        $path = [IO.Path]::GetFullPath((Join-Path $Root $relative))
        if (-not $path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { $failures.Add('Checksum path outside the release'); continue }
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { $failures.Add($relative + ' missing'); continue }
        if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) { $failures.Add($relative + ' differs from release checksum') }
    }
    if ($entries -eq 0) { $failures.Add('Checksum manifest contains no release files') }
    return $failures.ToArray()
}
function Invoke-WorkbenchProbe([string]$Executable, [string]$Arguments, [string]$Folder, [string]$Name, [int]$Seconds) {
    $stdout = Join-Path $Folder ($Name + '.stdout.txt'); $stderr = Join-Path $Folder ($Name + '.stderr.txt')
    $p = Start-Process -FilePath $Executable -ArgumentList $Arguments -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
    $null = $p.Handle
    try {
        if (-not $p.WaitForExit($Seconds * 1000)) { $p.Kill(); $p.WaitForExit(); throw "$Name exceeded $Seconds seconds" }
        $p.WaitForExit()
        if ($p.ExitCode -ne 0) { throw "$Name exited with code $($p.ExitCode)" }
        $text = [IO.File]::ReadAllText($stdout)
        if ($text.Length -gt 100000) { throw 'Probe output exceeded its report bound' }
        return $text.Trim()
    } finally { if (-not $p.HasExited) { try { $p.Kill() } catch {} }; $p.Dispose() }
}
