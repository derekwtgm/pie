param([switch]$BuildOnly,[switch]$Headless,[string]$ReadyFile,[switch]$ForceCompile)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$root=Get-WorkbenchRoot
try {
    if(-not [Environment]::Is64BitOperatingSystem -or -not [Environment]::Is64BitProcess){throw 'Use 64-bit Windows PowerShell to launch the desktop host.'}
    $failures=@(Get-WorkbenchHashFailures $root);if($failures.Count){throw ('Release verification failed: '+(($failures|Select-Object -First 5)-join '; '))}
    $source=Join-Path $root 'desktop\DesktopHost.cs';$captureSource=Join-Path $root 'desktop\CaptureService.cs'
    # 0.24: the host is compiled from two sources; the cache key covers both.
    $sourceHash=(Get-FileHash -InputStream ([IO.MemoryStream]::new([Text.Encoding]::UTF8.GetBytes(((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash+(Get-FileHash -LiteralPath $captureSource -Algorithm SHA256).Hash)))) -Algorithm SHA256).Hash.ToLowerInvariant()
    $cache=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ('EightMax-Test-Workbench\DesktopCache\'+$sourceHash)
    [IO.Directory]::CreateDirectory($cache)|Out-Null
    $exe=Join-Path $cache 'EightMaxWorkbench.exe';$stamp=Join-Path $cache 'compiler-output.sha256'
    # 0.19: prefer the prebuilt, manifest-verified host (no compile on first launch); fall back to compiling the shipped source.
    $prebuilt=Join-Path $root 'desktop\bin\EightMaxWorkbench.exe'
    $usePrebuilt=(-not $ForceCompile) -and (-not $BuildOnly) -and (Test-Path -LiteralPath $prebuilt -PathType Leaf)
    if($usePrebuilt){$rebuild=$false;$exe=$prebuilt}else{
    $rebuild=(-not (Test-Path -LiteralPath $exe -PathType Leaf)) -or (-not (Test-Path -LiteralPath $stamp -PathType Leaf))
    if(-not $rebuild){$rebuild=((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant() -ne [IO.File]::ReadAllText($stamp).Trim())}
    }
    if($rebuild){
        $temp=Join-Path $cache ('build-'+[guid]::NewGuid().ToString('N')+'.exe')
        Add-Type -AssemblyName Microsoft.CSharp,System.Web.Extensions,System.Windows.Forms,System.Drawing
        $provider=New-Object Microsoft.CSharp.CSharpCodeProvider
        $parameters=New-Object System.CodeDom.Compiler.CompilerParameters
        $parameters.GenerateExecutable=$true;$parameters.GenerateInMemory=$false;$parameters.OutputAssembly=$temp
        $parameters.CompilerOptions='/target:winexe /platform:x64 /optimize+'
        foreach($assembly in @([System.Uri].Assembly.Location,[System.Linq.Enumerable].Assembly.Location,[System.Web.Script.Serialization.JavaScriptSerializer].Assembly.Location,[System.Windows.Forms.Form].Assembly.Location,[System.Drawing.Point].Assembly.Location)){$null=$parameters.ReferencedAssemblies.Add($assembly)}
        try{$compiled=$provider.CompileAssemblyFromSource($parameters,[string[]]@([IO.File]::ReadAllText($source),[IO.File]::ReadAllText($captureSource)));if($compiled.Errors.HasErrors){throw (($compiled.Errors|ForEach-Object {$_.ToString()}) -join "`n")}}finally{$provider.Dispose()}
        Copy-Item -LiteralPath $temp -Destination $exe -Force
        try{Remove-Item -LiteralPath $temp -Force}catch{}
        Write-WorkbenchUtf8 $stamp ((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant())
    }
    if($BuildOnly){Write-Output $exe;exit 0}
    if(-not $ReadyFile){$session=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ('EightMax-Test-Workbench\DesktopSessions\'+[guid]::NewGuid().ToString('N'));[IO.Directory]::CreateDirectory($session)|Out-Null;$ReadyFile=Join-Path $session 'session.json'}
    $launchArgs='--root '+(Quote-WorkbenchPath $root)+' --ready '+(Quote-WorkbenchPath ([IO.Path]::GetFullPath($ReadyFile)));if($Headless){$launchArgs+=' --headless'}
    try{$launched=Start-Process -FilePath $exe -ArgumentList $launchArgs -PassThru}
    catch{
        if($usePrebuilt){Write-Warning ('Prebuilt host could not start ('+$_.Exception.Message+'); compiling from source instead.');& $PSCommandPath -ForceCompile -ReadyFile $ReadyFile;exit $LASTEXITCODE}
        throw
    }
    if($usePrebuilt -and -not $Headless){
        # A host that stays alive but never writes its ready file is treated as unusable; one that exits on its own has already shown its own error.
        $deadline=(Get-Date).AddSeconds(20);$ready=$false
        while((Get-Date) -lt $deadline){if(Test-Path -LiteralPath $ReadyFile){$ready=$true;break};if($launched.HasExited){$ready=$true;break};Start-Sleep -Milliseconds 250}
        if(-not $ready){
            try{if(-not $launched.HasExited){$launched.Kill()}}catch{}
            Write-Warning 'Prebuilt host did not become ready within 20 seconds; compiling from source instead.'
            & $PSCommandPath -ForceCompile -ReadyFile $ReadyFile;exit $LASTEXITCODE
        }
    }
    $launched.Id
} catch {
    if($Headless -or $BuildOnly){Write-Error $_.Exception.Message;exit 1}
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show($_.Exception.Message+"`n`nNo extra runtime is downloaded. You can use START.html and the manual native job runner while this Windows build is checked.",'EightMax desktop could not start','OK','Error')|Out-Null
    exit 1
}
