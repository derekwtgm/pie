# Verify the extracted release, then run the isolated native checks (source/tools/test_windows.ps1).
# Windows PowerShell 5.1 and .NET only.
# 4.6: the child's exit code is recorded; when the child ends without writing a report, a report
# saying so (with the exit code and the tail of its console output) is written instead of a pass.
$ErrorActionPreference='Stop'
$root=Split-Path (Split-Path $PSScriptRoot)
$report=Join-Path $root 'Windows-self-test.json'
$count=0
$started=(Get-Date).ToUniversalTime().ToString('o')
try {
  if(Test-Path -LiteralPath $report){Move-Item -LiteralPath $report -Destination ($report+'.previous') -Force}   # never read a stale report
  $index=Get-Content -Raw -LiteralPath (Join-Path $root 'BUILD-INFO.json') | ConvertFrom-Json
  $files=[IO.File]::ReadAllLines((Join-Path $root 'SHA256SUMS.txt'))
  foreach($entry in $files){
    if($entry -notmatch '^([0-9a-f]{64})  (.+)$'){throw "Invalid manifest entry $entry"}
    $expect=$Matches[1];$relative=$Matches[2]
    $path=Join-Path $root $relative
    if(-not (Test-Path -LiteralPath $path)){throw "Missing packaged file $relative"}
    if((Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash -ne $expect){throw "SHA-256 mismatch in $relative"}
    $count++
  }
  if($count -lt 1){throw 'Package manifest is empty'}
  $cliBuild=(& (Join-Path $root 'mwcli.exe') --build-id)
  if($LASTEXITCODE -ne 0 -or $cliBuild -ne ('EightMaxBuild='+$index.build)){throw "CLI build identifier '$cliBuild' differs from BUILD-INFO.json ($($index.build))"}
  $child=(Get-Command powershell.exe -ErrorAction Stop).Source
  $console=Join-Path ([IO.Path]::GetTempPath()) ('EightMax-self-test-console-'+[guid]::NewGuid()+'.txt')
  # Windows PowerShell 5.1 turns redirected native stderr into terminating errors under 'Stop'
  $ErrorActionPreference='Continue'
  & $child -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'source/tools/test_windows.ps1') -Report $report 2>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath $console | Out-Host
  $result=$LASTEXITCODE
  $ErrorActionPreference='Stop'
  if(-not (Test-Path -LiteralPath $report)){
    $tail=''; if(Test-Path -LiteralPath $console){$tail=(Get-Content -LiteralPath $console -Tail 60) -join "`n"}
    [ordered]@{passed=$false;version=$index.version;build=$null;error="test_windows.ps1 ended with exit code $result without writing its report";childExitCode=$result;consoleTail=$tail;startedAt=$started;os=[Environment]::OSVersion.VersionString} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $report -Encoding UTF8
    exit 1
  }
  Remove-Item -LiteralPath $console -ErrorAction SilentlyContinue
  $summary=Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
  if($summary.build -ne $index.build){$result=1;$summary.passed=$false;$summary.error='Desktop host build identifier '+$summary.build+' differs from BUILD-INFO.json '+$index.build}
  if(-not $summary.passed -and $result -eq 0){$result=1}
  $summary | Add-Member -NotePropertyName 'package' -NotePropertyValue ([ordered]@{sha256Files=$count;cliBuild=$cliBuild;sourceBuild=$index.build;hostBuild=$summary.build;childExitCode=$result}) -Force
  $summary | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $report -Encoding UTF8
  exit $result
} catch {
  [ordered]@{passed=$false;sha256FilesChecked=$count;error=$_.Exception.Message;startedAt=$started;os=[Environment]::OSVersion.VersionString} | ConvertTo-Json | Set-Content -LiteralPath $report -Encoding UTF8
  Write-Host $_.Exception.Message
  exit 1
}
