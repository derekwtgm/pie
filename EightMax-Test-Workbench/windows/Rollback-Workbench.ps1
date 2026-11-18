<#
 EightMax Test Workbench - roll the per-user installation back to the previously installed release.
 Earlier releases are kept by Install-Workbench.ps1, so rollback only re-points the Start menu entry, the
 uninstall record and install-state.json after re-verifying that release against its own manifest.
 User data (NativeJobs, Diagnostics, saved studies) is never touched.
 NOT EXECUTED during development (no Windows machine available); parse-checked only.
#>
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$base=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'EightMax-Test-Workbench'
$installed=Join-Path $base 'Installed';$statePath=Join-Path $base 'install-state.json'
$shortcut=Join-Path ([Environment]::GetFolderPath('Programs')) 'EightMax Test Workbench.lnk'
$registry='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\EightMaxTestWorkbench'
$locks=New-Object Collections.Generic.List[object]
try{
    foreach($name in @('Local\EightMaxWorkbenchDesktopHost','Local\EightMaxWorkbenchNativeJob')){
        $guard=New-Object Threading.Mutex($false,$name);$acquired=$false
        try{$acquired=$guard.WaitOne(0)}catch [Threading.AbandonedMutexException]{$acquired=$true}
        if(-not $acquired){$guard.Dispose();throw 'Close the desktop host and all native study managers before rolling back.'}
        $locks.Add($guard)
    }
    if(-not (Test-Path -LiteralPath $statePath -PathType Leaf)){throw 'No managed per-user installation was found.'}
    $state=[IO.File]::ReadAllText($statePath)|ConvertFrom-Json
    if($state.format -ne 'eightmax-workbench-install' -or $state.version -ne 1){throw 'Unrecognized install record; nothing was changed.'}
    $root=[IO.Path]::GetFullPath($installed)
    $candidates=@()
    foreach($path in @($state.releases)){
        $full=[IO.Path]::GetFullPath($path)
        if((Split-Path $full -Parent) -cne $root -or (Split-Path $full -Leaf) -notmatch '^0\.\d+\.\d+-[a-f0-9]{12}$'){throw 'Install record points outside managed releases; nothing was changed.'}
        if($full -cne [IO.Path]::GetFullPath([string]$state.activeRelease) -and (Test-Path -LiteralPath $full -PathType Container)){$candidates+=$full}
    }
    if(-not $candidates.Count){throw 'No earlier installed release is available to roll back to.'}
    $previous=$candidates[$candidates.Count-1]
    $failures=@(Get-WorkbenchHashFailures $previous)
    if($failures.Count){throw ('The earlier release no longer matches its manifest, so rollback was refused: '+(($failures|Select-Object -First 3)-join '; '))}
    $shell=New-Object -ComObject WScript.Shell;$link=$shell.CreateShortcut($shortcut)
    $link.TargetPath=Join-Path $PSHOME 'powershell.exe';$link.Arguments='-NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File '+(Quote-WorkbenchPath (Join-Path $previous 'windows\Start-Desktop.ps1'));$link.WorkingDirectory=$previous;$link.Save()
    $uninstall=(Quote-WorkbenchPath (Join-Path $PSHOME 'powershell.exe'))+' -NoLogo -NoProfile -ExecutionPolicy Bypass -File '+(Quote-WorkbenchPath (Join-Path $previous 'windows\Install-Workbench.ps1'))+' -Uninstall'
    New-Item -Path $registry -Force|Out-Null
    foreach($pair in @(@('InstallLocation',$previous),@('UninstallString',$uninstall),@('DisplayVersion',((Split-Path $previous -Leaf) -replace '-.*$','')))){New-ItemProperty -Path $registry -Name $pair[0] -Value $pair[1] -PropertyType String -Force|Out-Null}
    $state.activeRelease=$previous
    Write-WorkbenchUtf8 ($statePath+'.tmp') ($state|ConvertTo-Json -Depth 6)
    [IO.File]::Replace($statePath+'.tmp',$statePath,$null)
    Write-Host ('Rolled back to '+(Split-Path $previous -Leaf)+'. Saved studies and checkpoints were not changed.')
}catch{Write-Host $_.Exception.Message;exit 1}
finally{foreach($guard in $locks){$guard.ReleaseMutex();$guard.Dispose()}}
