param([switch]$Uninstall)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$base=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'EightMax-Test-Workbench'
$installed=Join-Path $base 'Installed';$statePath=Join-Path $base 'install-state.json'
$shortcut=Join-Path ([Environment]::GetFolderPath('Programs')) 'EightMax Test Workbench.lnk'
$registry='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\EightMaxTestWorkbench'
$installLocks=New-Object Collections.Generic.List[object]
try {
    foreach($name in @('Local\EightMaxWorkbenchDesktopHost','Local\EightMaxWorkbenchNativeJob')){
        $guard=New-Object Threading.Mutex($false,$name);$acquired=$false
        try{$acquired=$guard.WaitOne(0)}catch [Threading.AbandonedMutexException]{$acquired=$true}
        if(-not $acquired){$guard.Dispose();throw 'Close the desktop host and all native study managers before installing, updating or uninstalling.'}
        $installLocks.Add($guard)
    }
    if($Uninstall){
        if(-not (Test-Path -LiteralPath $statePath -PathType Leaf)){throw 'No managed per-user installation was found.'}
        $state=[IO.File]::ReadAllText($statePath)|ConvertFrom-Json
        if($state.format -ne 'eightmax-workbench-install' -or $state.version -ne 1){throw 'Unrecognized install record; no files were removed.'}
        foreach($path in @($state.releases)){
            $full=[IO.Path]::GetFullPath($path);if((Split-Path $full -Parent) -cne [IO.Path]::GetFullPath($installed) -or (Split-Path $full -Leaf) -notmatch '^0\.\d+\.\d+-[a-f0-9]{12}$'){throw 'Install record points outside managed releases; no files were removed.'}
        }
        foreach($path in @($state.releases)){if(Test-Path -LiteralPath $path){Remove-Item -LiteralPath $path -Recurse -Force}}
        foreach($name in @('DesktopCache','DesktopSessions')){$owned=Join-Path $base $name;if(Test-Path -LiteralPath $owned){Remove-Item -LiteralPath $owned -Recurse -Force}}
        if(Test-Path -LiteralPath $shortcut){Remove-Item -LiteralPath $shortcut -Force};if(Test-Path $registry){Remove-Item $registry -Recurse -Force};Remove-Item -LiteralPath $statePath -Force
        Write-Host 'Application release files and Start menu entry removed. NativeJobs, Diagnostics, browser recovery and saved study files were preserved.'
        exit 0
    }
    $root=Get-WorkbenchRoot;$failures=@(Get-WorkbenchHashFailures $root);if($failures.Count){throw ('Extract the complete release. Verification failed: '+(($failures|Select-Object -First 5)-join '; '))}
    $manifest=Join-Path $root 'SHA256SUMS.txt';$hash=(Get-FileHash -LiteralPath $manifest -Algorithm SHA256).Hash.ToLowerInvariant();$release='0.25.0-'+$hash.Substring(0,12);$target=Join-Path $installed $release
    [IO.Directory]::CreateDirectory($installed)|Out-Null
    if(-not (Test-Path -LiteralPath $target)){
        $stage=Join-Path $installed ('staging-'+[guid]::NewGuid().ToString('N'));[IO.Directory]::CreateDirectory($stage)|Out-Null
        try{foreach($line in [IO.File]::ReadAllLines($manifest)){$relative=$line.Substring(66);$source=Join-Path $root $relative;$dest=Join-Path $stage $relative;[IO.Directory]::CreateDirectory((Split-Path $dest -Parent))|Out-Null;Copy-Item -LiteralPath $source -Destination $dest -Force};Copy-Item -LiteralPath $manifest -Destination (Join-Path $stage 'SHA256SUMS.txt');$bad=@(Get-WorkbenchHashFailures $stage);if($bad.Count){throw 'Staged release bytes differ; existing installation was kept.'};Move-Item -LiteralPath $stage -Destination $target}
        finally{if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Recurse -Force}}
    }
    $installedFailures=@(Get-WorkbenchHashFailures $target);if($installedFailures.Count){throw 'Existing installed release differs from its manifest; activation was refused. Use the verified extracted release until that installation is repaired.'}
    $releases=@();if(Test-Path -LiteralPath $statePath){$prior=[IO.File]::ReadAllText($statePath)|ConvertFrom-Json;if($prior.format -ne 'eightmax-workbench-install' -or $prior.version -ne 1){throw 'Unrecognized existing install state; current shortcut was kept.'};$releases=@($prior.releases)}
    $releases=@($releases+$target|Select-Object -Unique)
    $shell=New-Object -ComObject WScript.Shell;$link=$shell.CreateShortcut($shortcut);$link.TargetPath=Join-Path $PSHOME 'powershell.exe';$link.Arguments='-NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File '+(Quote-WorkbenchPath (Join-Path $target 'windows\Start-Desktop.ps1'));$link.WorkingDirectory=$target;$link.Description='EightMax Test Workbench desktop host';$link.Save()
    New-Item -Path $registry -Force|Out-Null
    $uninstall=(Quote-WorkbenchPath (Join-Path $PSHOME 'powershell.exe'))+' -NoLogo -NoProfile -ExecutionPolicy Bypass -File '+(Quote-WorkbenchPath (Join-Path $target 'windows\Install-Workbench.ps1'))+' -Uninstall'
    foreach($pair in @(@('DisplayName','EightMax Test Workbench'),@('DisplayVersion','0.25.0'),@('Publisher','EightMax Test Workbench'),@('InstallLocation',$target),@('UninstallString',$uninstall))){New-ItemProperty -Path $registry -Name $pair[0] -Value $pair[1] -PropertyType String -Force|Out-Null}
    $state=[ordered]@{format='eightmax-workbench-install';version=1;appVersion='0.25.0';activeRelease=$target;releases=$releases;manifestSHA256=$hash}
    Write-WorkbenchUtf8 ($statePath+'.tmp') ($state|ConvertTo-Json -Depth 6);if(Test-Path -LiteralPath $statePath){[IO.File]::Replace($statePath+'.tmp',$statePath,$null)}else{[IO.File]::Move($statePath+'.tmp',$statePath)}
    Write-Host 'Installed for this Windows user. Open EightMax Test Workbench from the Start menu. Earlier release folders and user data are retained.'
} catch {Write-Host $_.Exception.Message;exit 1}
finally{foreach($guard in $installLocks){$guard.ReleaseMutex();$guard.Dispose()}}
