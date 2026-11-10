# Verify the extracted release before running the existing isolated native checks.
# Uses Windows PowerShell 5.1 and .NET.
$ErrorActionPreference='Stop'
$root=Split-Path (Split-Path $PSScriptRoot)
$report=Join-Path $root 'Windows-self-test.json'
$count=0
try {
  $index=Get-Content -Raw -LiteralPath (Join-Path $root 'BUILD-INFO.json') | ConvertFrom-Json
  $files=[IO.File]::ReadAllLines((Join-Path $root 'SHA256SUMS.txt'))
  foreach($entry in $files){
    if($entry -notmatch '^([0-9a-f]{64})  (.+)$'){throw "Invalid manifest entry $entry"}
    $expect=$Matches[1];$relative=$Matches[2]
    if((Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $root $relative)).Hash -ne $expect){throw "SHA-256 mismatch in $relative"}
    $count++
  }
  if($count -lt 1){throw 'Package manifest is empty'}
  $cliBuild=(& (Join-Path $root 'mwcli.exe') --build-id)
  if($LASTEXITCODE -ne 0 -or $cliBuild -ne ('EightMaxBuild='+$index.build)){throw 'CLI build identifier differs from BUILD-INFO.json'}
  $child=(Get-Command powershell.exe -ErrorAction Stop).Source
  & $child -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'source/tools/test_windows.ps1') -Report $report
  $result=$LASTEXITCODE
  $summary=Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
  if($summary.build -ne $index.build){$result=1;$summary.passed=$false;$summary.error='Desktop host build identifier differs from BUILD-INFO.json'}
  $summary | Add-Member -NotePropertyName 'package' -NotePropertyValue ([ordered]@{sha256Files=$count;cliBuild=$cliBuild;sourceBuild=$index.build;hostBuild=$summary.build})
  $summary | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $report -Encoding UTF8
  exit $result
} catch {
  [ordered]@{passed=$false;sha256FilesChecked=$count;error=$_.Exception.Message;os=[Environment]::OSVersion.VersionString} | ConvertTo-Json | Set-Content -LiteralPath $report -Encoding UTF8
  Write-Host $_.Exception.Message
  exit 1
}
