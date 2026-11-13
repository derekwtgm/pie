# Called inside test_windows.ps1's isolated profile. Uses the installed CLI,
# .NET and the desktop HTTP interface. Both transfers use FileStream.
param([string]$Base,[string]$Work,[string]$Cli,[string]$Store)
$ErrorActionPreference='Stop'
$root=Split-Path (Split-Path $PSScriptRoot)
$f=Join-Path $root 'validation/3.6/linked-fixture'
$state=Join-Path $Work 'large-native.state'
$spec=Join-Path $f 'spec.json'
$info=(& $Cli $spec 20000 2 $state 960) | ConvertFrom-Json
if($LASTEXITCODE -ne 0 -or $info.iterations -ne 20000){throw 'Large fixture training failed'}
$meta=[IO.File]::ReadAllText((Join-Path $f 'meta.json')).Replace('"iterations":8','"iterations":20000')
if(!$meta.Contains('"iterations":20000')){throw 'Large fixture metadata did not match'}
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Security.Cryptography;
public static class EightMaxStreamCheck {
  public static void Write(string input,string output,string meta){
    byte[] m=Encoding.UTF8.GetBytes(meta);
    using(var src=File.OpenRead(input))using(var dst=new BinaryWriter(File.Create(output)))
    using(var manifest=new MemoryStream())using(var writer=new BinaryWriter(manifest))
    using(var sha=SHA256.Create()){
      writer.Write(Encoding.ASCII.GetBytes("EMCP36\r\n"));writer.Write(1);writer.Write(m.Length);writer.Write(src.Length);writer.Write(m);
      dst.Write(manifest.ToArray());byte[] buf=new byte[256*1024];
      while(src.Position<src.Length){int n=(int)Math.Min(buf.Length,src.Length-src.Position);int used=0;
        while(used<n){int count=src.Read(buf,used,n-used);if(count==0)throw new EndOfStreamException();used+=count;}
        byte[] hash=sha.ComputeHash(buf,0,n);writer.Write(n);writer.Write(n);writer.Write(hash);
        dst.Write(n);dst.Write(n);dst.Write(hash);dst.Write(buf,0,n);}
      manifest.Position=0;dst.Write(sha.ComputeHash(manifest));
    }
  }
}
'@
$file=Join-Path $Work 'large.emstudy'
[EightMaxStreamCheck]::Write($state,$file,$meta)
$bytes=(Get-Item -LiteralPath $file).Length
if($bytes -le 64MB){throw 'Large checkpoint is below the required boundary'}
$request=[Net.HttpWebRequest]::Create("$Base/api/checkpoint/write")
$request.Method='POST';$request.Headers.Add('X-EightMax','1');$request.ContentType='application/vnd.eightmax.checkpoint'
$request.Timeout=1200000;$request.ReadWriteTimeout=1200000;$request.AllowWriteStreamBuffering=$false;$request.ContentLength=$bytes
$clock=[Diagnostics.Stopwatch]::StartNew();$src=[IO.File]::OpenRead($file)
try{$stream=$request.GetRequestStream();try{$src.CopyTo($stream,65536)}finally{$stream.Dispose()}}finally{$src.Dispose()}
$response=$request.GetResponse();try{$reader=New-Object IO.StreamReader($response.GetResponseStream());$ack=$reader.ReadToEnd()|ConvertFrom-Json;if(!$ack.ok){throw 'Missing desktop commit acknowledgement'}}finally{$response.Dispose()}
$saveMs=$clock.ElapsedMilliseconds
Remove-Item -LiteralPath (Join-Path $Store 'autosave.index')
$status=Invoke-RestMethod "$Base/api/checkpoint/status" -TimeoutSec 1200
if(!$status.reconstructed -or $status.sizeBytes -ne $bytes){throw 'Large checkpoint generation recovery failed'}
$copy=Join-Path $Work 'recovered.emstudy'
$req=[Net.HttpWebRequest]::Create("$Base/api/checkpoint/latest");$req.Timeout=1200000;$response=$req.GetResponse()
try{$dest=[IO.File]::Create($copy);try{$response.GetResponseStream().CopyTo($dest,65536)}finally{$dest.Dispose()}}finally{$response.Dispose()}
$hash=(Get-FileHash $file).Hash
if((Get-FileHash $copy).Hash -ne $hash){throw 'Large recovered file SHA-256 mismatch'}
[pscustomobject]@{bytes=$bytes;sha256=$hash;updates=$info.iterations;deals=$info.trainingDeals;generation=$status.generation;saveMilliseconds=$saveMs}
