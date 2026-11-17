<#
 EightMax Test Workbench - Windows hardware validation (facts collector).
 Collects OS, CPU, RAM, GPU/VRAM, nvidia-smi and runs a short native CPU study with the bundled mwcli.exe.
 Writes hardware-facts.json and hardware-report.txt under %LOCALAPPDATA%\EightMax-Test-Workbench\Reports and prints the path.
 It never reports GPU acceleration: no GPU code path is executed by the bundled solver CLI.
 NOT EXECUTED during development (no Windows machine was available). See docs\WINDOWS-ACCEPTANCE.md for expected output.
#>
param([switch]$NoSelfTest,[string]$OutputDirectory)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$root=Get-WorkbenchRoot
function Try-Value([scriptblock]$Block,$Default=$null){try{& $Block}catch{$Default}}
try{
    $os=Try-Value {Get-CimInstance Win32_OperatingSystem}
    $cpu=@(Try-Value {Get-CimInstance Win32_Processor} @())
    $sys=Try-Value {Get-CimInstance Win32_ComputerSystem}
    $gpus=@(Try-Value {Get-CimInstance Win32_VideoController} @())
    $gpuFacts=@()
    foreach($g in $gpus){
        # Win32_VideoController.AdapterRAM is a 32-bit field and caps at 4 GiB; nvidia-smi below is authoritative for NVIDIA cards.
        $gpuFacts+=[ordered]@{name=[string]$g.Name;vramBytes=$(if($g.AdapterRAM){[double]$g.AdapterRAM}else{$null});driver=[string]$g.DriverVersion;vramSource='Win32_VideoController (capped at 4 GiB)'}
    }
    $smiPath=Try-Value {(Get-Command nvidia-smi.exe -ErrorAction Stop).Source}
    $smi=[ordered]@{present=$false;cudaVersion=$null}
    if($smiPath){
        $line=Try-Value {& $smiPath '--query-gpu=name,memory.total,driver_version' '--format=csv,noheader,nounits' 2>$null}
        $smi.present=$true
        $header=Try-Value {(& $smiPath 2>$null | Select-String 'CUDA Version:\s*([0-9.]+)').Matches[0].Groups[1].Value}
        if($header){$smi.cudaVersion=$header}
        if($line){
            $gpuFacts=@()
            foreach($row in @($line)){$p=([string]$row).Split(',')|ForEach-Object{$_.Trim()};if($p.Count -ge 3){$gpuFacts+=[ordered]@{name=$p[0];vramBytes=[double]$p[1]*1MB;driver=$p[2];vramSource='nvidia-smi'}}}
        }
    }
    $native=[ordered]@{present=$false;hashMatches=$null;selfTest=[ordered]@{ran=$false;passed=$false;detail=''}}
    $exe=Join-Path $root 'native\mwcli.exe'
    if(Test-Path -LiteralPath $exe -PathType Leaf){
        $native.present=$true
        $native.hashMatches=((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant() -eq 'b3e675bfe2ae231e7d637de07886af6b511905d5225db96fe12ce2c3ccab2f72')
        if(-not $NoSelfTest){
            $job=Get-Content -LiteralPath (Join-Path $root 'native\demo-native-job.json') -Raw|ConvertFrom-Json
            $work=Join-Path ([IO.Path]::GetTempPath()) ('eightmax-hw-'+[guid]::NewGuid().ToString('N'));[IO.Directory]::CreateDirectory($work)|Out-Null
            try{
                $spec=Join-Path $work 'spec.json';$state=Join-Path $work 'out.state'
                [IO.File]::WriteAllText($spec,($job.spec|ConvertTo-Json -Depth 32 -Compress),(New-Object Text.UTF8Encoding($false)))
                $sw=[Diagnostics.Stopwatch]::StartNew()
                $psi=New-Object Diagnostics.ProcessStartInfo;$psi.FileName=$exe;$psi.Arguments='"'+$spec+'" 2000 1 "'+$state+'" 128';$psi.UseShellExecute=$false;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true;$psi.CreateNoWindow=$true
                $proc=[Diagnostics.Process]::Start($psi);$out=$proc.StandardOutput.ReadToEndAsync();$err=$proc.StandardError.ReadToEndAsync()
                if(-not $proc.WaitForExit(60000)){try{$proc.Kill()}catch{};$native.selfTest.detail='timed out after 60 s'}
                else{$sw.Stop();$native.selfTest.ran=$true;$native.selfTest.passed=($proc.ExitCode -eq 0 -and (Test-Path -LiteralPath $state) -and (Get-Item -LiteralPath $state).Length -gt 0);$native.selfTest.detail=('exit '+$proc.ExitCode+', 2000 updates in '+[int]$sw.Elapsed.TotalMilliseconds+' ms')}
            }catch{$native.selfTest.detail=$_.Exception.Message}
            finally{try{Remove-Item -LiteralPath $work -Recurse -Force}catch{}}
        }
    }
    $facts=[ordered]@{
        format='eightmax-hardware-facts';version=1;collector='powershell-cim';collectedAt=[DateTime]::UtcNow.ToString('o')
        os=[ordered]@{name=[string]$os.Caption;version=[string]$os.Version;build=[string]$os.BuildNumber;arch=$(if([Environment]::Is64BitOperatingSystem){'x64'}else{'x86'})}
        cpu=[ordered]@{model=[string](($cpu|Select-Object -First 1).Name).Trim();cores=[int](($cpu|Measure-Object NumberOfCores -Sum).Sum);logical=[int](($cpu|Measure-Object NumberOfLogicalProcessors -Sum).Sum)}
        memory=[ordered]@{totalBytes=[double]$sys.TotalPhysicalMemory;availableBytes=[double]($os.FreePhysicalMemory*1KB)}
        gpus=$gpuFacts;nvidiaSmi=$smi;nativeSolver=$native
        gpuAcceleration=[ordered]@{executed=$false;evidence=$null;note='No GPU code path is executed by this tool.'}
    }
    $dir=$OutputDirectory;if(-not $dir){$dir=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'EightMax-Test-Workbench\Reports'}
    [IO.Directory]::CreateDirectory($dir)|Out-Null
    $file=Join-Path $dir 'hardware-facts.json'
    Write-WorkbenchUtf8 $file ($facts|ConvertTo-Json -Depth 8)
    Write-Output ('Hardware facts written to '+$file)
    Write-Output 'Open the dashboard, choose "Hardware validation" and load this file to see the classified report.'
    exit 0
}catch{
    Write-Error ('Hardware validation failed: '+$_.Exception.Message);exit 1
}
