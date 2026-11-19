// Compiled on first Windows launch using Windows PowerShell/.NET Framework.
// No client capture/input. Fixed local routes and a session-bound native runner only.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("EightMax Workbench desktop host")]
[assembly: System.Reflection.AssemblyProduct("EightMax Test Workbench")]
[assembly: System.Reflection.AssemblyVersion("0.33.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("0.33.0.0")]
[assembly: System.Reflection.AssemblyInformationalVersion("0.33.0")]
namespace EightMax.Workbench {
public sealed class DesktopHost {
    public const string Version="0.33.0", Build="7d08acc7eb4577ee";
    const int Port=48713, MaxJob=1000000, MaxResult=6000000, MaxBindings=256, MaxRevision=256;
    readonly string root, data, token, readyFile;
    readonly JavaScriptSerializer json=new JavaScriptSerializer { MaxJsonLength=MaxResult, RecursionLimit=64 };
    readonly object gate=new object();
    readonly Dictionary<string,string> submissions=new Dictionary<string,string>(StringComparer.Ordinal);
    readonly HashSet<string> cancelledAttempts=new HashSet<string>(StringComparer.Ordinal);
    TcpListener listener; Thread serverThread; Form window; ApplicationContext context; Control invoker; volatile bool shutdownRequested; readonly RequestLog requests=new RequestLog();
    bool closing; uint uiThread; NativeRun current;NativeBatch batch;System.Threading.Timer batchTimer;readonly HashSet<string> batchFences=new HashSet<string>(StringComparer.Ordinal);
    public DesktopHost(string release,string ready) {
        root=Path.GetFullPath(release);readyFile=Path.GetFullPath(ready);CaptureService.HelperRoot=Path.Combine(root,"desktop","bin");
        if(!Environment.Is64BitProcess)throw new Exception("Open the desktop launcher in 64-bit Windows PowerShell.");
        if(!File.Exists(Path.Combine(root,"START.html"))||!File.Exists(Path.Combine(root,"native","Run-Native-Study.ps1")))throw new Exception("Extract the complete release first.");
        string exe=Path.Combine(root,"native","mwcli.exe");
        using(SHA256 hash=SHA256.Create())using(FileStream stream=File.OpenRead(exe))if(Hex(hash.ComputeHash(stream))!="b3e675bfe2ae231e7d637de07886af6b511905d5225db96fe12ce2c3ccab2f72")throw new Exception("EightMax native binary identity differs from the supplied 5.1 release.");
        data=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"EightMax-Test-Workbench","NativeJobs");Directory.CreateDirectory(data);
        Directory.CreateDirectory(Path.Combine(data,"Archive"));LoadLastBatch();
        byte[] random=new byte[32];using(RandomNumberGenerator rng=RandomNumberGenerator.Create())rng.GetBytes(random);token=Hex(random);
    }
    static string Hex(byte[] bytes){return BitConverter.ToString(bytes).Replace("-","").ToLowerInvariant();}
    static void Write(string path,string value){File.WriteAllText(path,value,new UTF8Encoding(false));}
    static Dictionary<string,object> Obj(object value){Dictionary<string,object> d=value as Dictionary<string,object>;if(d==null)throw new Exception("Expected a JSON object.");return d;}
    static object Get(Dictionary<string,object>d,string key){object v;return d.TryGetValue(key,out v)?v:null;}
    static string Str(object value,int max){string s=value as string;if(s==null||s.Length==0||s.Length>max)throw new Exception("Invalid text metadata.");return s;}
    static int Int(object value,int low,int high){if(!(value is int)&&!(value is long)&&!(value is decimal)&&!(value is double))throw new Exception("Expected numeric control.");double n=Convert.ToDouble(value);if(Double.IsNaN(n)||Double.IsInfinity(n)||Math.Floor(n)!=n||n<low||n>high)throw new Exception("Numeric control outside its bound.");return (int)n;}
    static object[] Arr(object value,int max){System.Collections.IList list=value as System.Collections.IList;if(list==null||list.Count>max)throw new Exception("Invalid array data.");object[] a=new object[list.Count];list.CopyTo(a,0);return a;}
    static bool AsciiToken(string text){foreach(char c in text)if(!(c>='a'&&c<='z'||c>='A'&&c<='Z'||c>='0'&&c<='9'||c=='-'||c=='_'))return false;return true;}
    // 0.18: limits match the unmodified engine (10M updates); RAM is checked by the runner.
    const int MaxUpdates=10000000;
    static void ValidateConvergence(object value){if(value==null)return;Dictionary<string,object> c=Obj(value);foreach(string k in c.Keys)if(k!="method"&&k!="everyChunks"&&k!="timeLimitSeconds"&&k!="targetPctPot")throw new Exception("Unknown convergence setting.");
        object m=Get(c,"method");if(m!=null&&Array.IndexOf(new[]{"auto","exact","restricted","sampled","off"},m as string)<0)throw new Exception("Invalid convergence method.");
        if(Get(c,"everyChunks")!=null)Int(Get(c,"everyChunks"),0,1000);if(Get(c,"timeLimitSeconds")!=null)Int(Get(c,"timeLimitSeconds"),5,3600);
        object t=Get(c,"targetPctPot");if(t!=null){if(!(t is int)&&!(t is long)&&!(t is decimal)&&!(t is double))throw new Exception("Invalid convergence target.");double d=Convert.ToDouble(t,CultureInfo.InvariantCulture);if(Double.IsNaN(d)||d<0.001||d>100)throw new Exception("Invalid convergence target.");}}
    void ValidateJob(Dictionary<string,object> job){
        if((string)Get(job,"format")!="eightmax-workbench-native-job")throw new Exception("Unsupported native job.");int version=Int(Get(job,"version"),1,2);
        if((string)Get(Obj(Get(job,"engine")),"build")!=Build)throw new Exception("Wrong engine build.");Str(Get(job,"id"),100);
        Int(Get(job,"iterations"),1,MaxUpdates);Int(Get(job,"threads"),1,4);Int(Get(job,"memoryMiB"),32,16384);Int(Get(job,"timeoutSeconds"),1,604800);Int(Get(job,"chunkUpdates"),1,1000000);ValidateConvergence(Get(job,"convergence"));
        Dictionary<string,object> spec=Obj(Get(job,"spec"));if(Int(Get(spec,"protocol"),4,4)!=4||(string)Get(spec,"algorithm")!="external"||(string)Get(spec,"device")!="cpu")throw new Exception("Only CPU protocol-4 external sampling is supported.");
        Dictionary<string,object> binding=Obj(Get(job,"workbench"));Int(Get(binding,"slot"),1,10);if(!AsciiToken(Str(Get(binding,"token"),80)))throw new Exception("Invalid study binding.");
        Dictionary<string,object> query=Obj(Get(job,"query"));if(query.Count!=4)throw new Exception("Unknown query fields.");object[] path=Arr(Get(query,"path"),128),board=Arr(Get(query,"board"),5);foreach(object a in path)Int(a,0,6);foreach(object c in board)Int(c,0,51);Int(Get(query,"offset"),0,0);Int(Get(query,"limit"),1326,1326);
        if(version==1&&(path.Length!=0||board.Length!=0||Get(job,"reviewed")!=null))throw new Exception("Version-1 jobs are root-only.");
        if(version==2){Dictionary<string,object> node=Obj(Get(job,"reviewed"));if((string)Get(node,"format")!="eightmax-reviewed-node"||Int(Get(node,"version"),1,1)!=1||!Object.Equals(Get(node,"decisionReady"),false))throw new Exception("Invalid captured reviewed target.");}
    }
    static string Canonical(object value,JavaScriptSerializer json){
        if(value==null)return "null";if(value is string)return json.Serialize(value);if(value is bool)return (bool)value?"true":"false";
        Dictionary<string,object> obj=value as Dictionary<string,object>;if(obj!=null){List<string> keys=new List<string>(obj.Keys);keys.Sort(StringComparer.Ordinal);StringBuilder b=new StringBuilder("{");foreach(string k in keys){if(b.Length>1)b.Append(',');b.Append(json.Serialize(k)).Append(':').Append(Canonical(obj[k],json));}return b.Append('}').ToString();}
        System.Collections.IList list=value as System.Collections.IList;if(list!=null){StringBuilder b=new StringBuilder("[");foreach(object v in list){if(b.Length>1)b.Append(',');b.Append(Canonical(v,json));}return b.Append(']').ToString();}
        if(value is int||value is long||value is decimal||value is double){double n=Convert.ToDouble(value,CultureInfo.InvariantCulture);if(Double.IsNaN(n)||Double.IsInfinity(n))throw new Exception("Non-finite native job number.");return n.ToString("R",CultureInfo.InvariantCulture);}throw new Exception("Unsupported JSON job value.");
    }
    string JobHash(object job){using(SHA256 hash=SHA256.Create())return Hex(hash.ComputeHash(Encoding.UTF8.GetBytes(Canonical(job,json))));}
    static string BindingKey(Dictionary<string,object> job){Dictionary<string,object> b=Obj(Get(job,"workbench"));return Int(Get(b,"slot"),1,10).ToString(CultureInfo.InvariantCulture)+":"+Str(Get(b,"token"),80);}
    static string AttemptKey(string key,int attempt){return key+"@"+attempt.ToString(CultureInfo.InvariantCulture);}
    Dictionary<string,object> ReadJob(Request r,out string text,out string key,out string hash){
        string type;if(!r.Headers.TryGetValue("Content-Type",out type)||type.Split(';')[0].Trim()!="application/json")throw new Exception("Use application/json data.");
        text=new UTF8Encoding(false,true).GetString(r.Body);Dictionary<string,object> job=Obj(json.DeserializeObject(text));ValidateJob(job);key=BindingKey(job);hash=JobHash(job);return job;
    }
    int ReadRevisionBody(Request r){Dictionary<string,object> body=Obj(json.DeserializeObject(new UTF8Encoding(false,true).GetString(r.Body)));if(body.Count!=1)throw new Exception("Attempt control accepts revision only.");return Int(Get(body,"revision"),1,MaxRevision);}
    object CurrentView(){return current==null?new{format="eightmax-desktop-current",version=1,job=(object)null,status=(object)null}:current.RecoveryView();}
    public void Run(bool headless){
        try{uiThread=Native.GetCurrentThreadId();}catch(Exception){uiThread=0;}listener=new TcpListener(IPAddress.Loopback,Port);try{listener.Start(8);}catch(SocketException e){throw new Exception("Port "+Port+" on 127.0.0.1 is already in use by another program (error "+e.SocketErrorCode+"). Close that program or restart Windows, then start the workbench again.");}
        // 0.28.0: the UI-thread invoker exists before the ready file, so a shutdown request can always reach the message loop.
        invoker=new Control();invoker.CreateControl();IntPtr forceHandle=invoker.Handle;
        context=new ApplicationContext();
        // 0.28.0: the ready file is written atomically (temp + move) so a test polling for it never reads a partial file.
        Directory.CreateDirectory(Path.GetDirectoryName(readyFile));string readyTemp=readyFile+"."+Process.GetCurrentProcess().Id+".tmp";Write(readyTemp,json.Serialize(new {format="eightmax-desktop-session",version=1,appVersion=Version,origin="http://127.0.0.1:"+Port,token=token,processId=Process.GetCurrentProcess().Id,requestLog=RequestLog.FilePath}));if(File.Exists(readyFile))File.Delete(readyFile);File.Move(readyTemp,readyFile);
        if(!headless){window=new Form();window.Text="EightMax Workbench desktop host";window.Size=new Size(530,230);window.StartPosition=FormStartPosition.CenterScreen;
            Label label=new Label();label.Text="The dashboard controls native CPU studies through this local host.\r\nClosing this host stops its managed native study.\r\nNo poker client is accessed.";label.SetBounds(18,18,480,65);window.Controls.Add(label);
            Button open=new Button();open.Text="Open workbench";open.SetBounds(18,100,145,32);open.Click+=delegate{OpenBrowser();};window.Controls.Add(open);
            Button stop=new Button();stop.Text="Stop native study";stop.SetBounds(175,100,145,32);stop.Click+=delegate{lock(gate){StopBatch("Stopped from desktop host.");}};window.Controls.Add(stop);
            window.FormClosed+=delegate{Stop();context.ExitThread();};window.Show();}
        batchTimer=new System.Threading.Timer(BackgroundTick,null,200,200);serverThread=new Thread(ServerLoop);serverThread.IsBackground=true;serverThread.Start();
        if(!headless)OpenBrowser();
        try{Application.Run(context);}finally{Stop();requests.Note("host-exit","message loop ended; shutdownRequested="+shutdownRequested);requests.Flush();if(invoker!=null)try{invoker.Dispose();}catch{}}
    }
    void OpenBrowser(){
        string address="http://127.0.0.1:"+Port+"/#desktop-token="+token;
        List<string> candidates=new List<string>();foreach(string folder in new[]{Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86)}){candidates.Add(Path.Combine(folder,"Microsoft","Edge","Application","msedge.exe"));candidates.Add(Path.Combine(folder,"Google","Chrome","Application","chrome.exe"));}candidates.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Google","Chrome","Application","chrome.exe"));
        foreach(string browser in candidates)if(File.Exists(browser)){Process.Start(new ProcessStartInfo(browser,"--app="+address){UseShellExecute=false});return;}
        Process.Start(new ProcessStartInfo(address){UseShellExecute=true});
    }
    void Stop(){lock(gate){if(closing)return;closing=true;if(batchTimer!=null)batchTimer.Dispose();try{StopBatch("Desktop host closed.");}catch{if(current!=null)try{current.Cancel("Desktop host closed.");}catch{}}}try{int n=CaptureService.CloseAllStreams();if(n>0)requests.Note("capture-sessions-closed",n+" Windows Graphics Capture session(s) ended");}catch{}if(listener!=null)try{listener.Stop();}catch{}try{File.Delete(readyFile);}catch{}requests.Flush();}
    sealed class Request { public string Method,Path,Step,Id;public Dictionary<string,string> Headers;public byte[] Body;public bool ViaProxy,AbsoluteForm; }
    // 0.28.0: every refusal carries an HTTP status, a stable machine-readable code and a safe human message.
    public sealed class RequestError : Exception { public readonly int Status;public readonly string Code;public string Method,Path,HeaderNames; public RequestError(int status,string code,string message):base(message){Status=status;Code=code;} }
    // 0.28.0 framing rules (see docs/DESKTOP-PROTOCOL-0.28.md).
    // ROOT CAUSE FIXED: .NET Framework HttpWebRequest -- used by Windows PowerShell 5.1 Invoke-WebRequest -- sends
    // "Expect: 100-continue" on every POST that has a body. 0.26.0 refused any Expect header with HTTP 400 "Invalid local
    // request framing/host.", so job submission, cancel, resume and cancel-intent could never succeed from PowerShell.
    // Now "Expect: 100-continue" is answered with an interim "100 Continue" and the body is read normally; any other
    // expectation is refused with 417. Chunked bodies stay unsupported (411). The Host check is kept (it blocks DNS
    // rebinding) and accepts the two loopback spellings of this port only.
    public static string[] AllowedHosts(int port){return new[]{"127.0.0.1:"+port,"localhost:"+port};}
    Request ReadRequest(NetworkStream stream){
        stream.ReadTimeout=5000;stream.WriteTimeout=5000;MemoryStream header=new MemoryStream();int end=0;
        while(end!=4){int c;try{c=stream.ReadByte();}catch(IOException){throw new RequestError(408,"request-timeout","The request headers did not arrive within 5 seconds.");}if(c<0)throw new RequestError(400,"incomplete-request","The connection closed before the request headers were complete.");header.WriteByte((byte)c);if(header.Length>16384)throw new RequestError(431,"headers-too-large","Request headers exceed 16 KiB.");end=(end==0&&c==13)?1:(end==1&&c==10)?2:(end==2&&c==13)?3:(end==3&&c==10)?4:(c==13?1:0);}
        string head=Encoding.ASCII.GetString(header.ToArray());
        try{return ParseHead(head,stream);}
        catch(RequestError e){
            // Diagnostics for refused framing: request line method/path and header NAMES only (values may hold the session token).
            string[] lines=head.Split(new[]{"\r\n"},StringSplitOptions.None);string[] first=lines[0].Split(' ');e.Method=first.Length>0?SafeName(first[0]):null;e.Path=first.Length>1?SafeName(first[1]):null;
            List<string> names=new List<string>();for(int i=1;i<lines.Length&&names.Count<30;i++){int c=lines[i].IndexOf(':');if(c>0)names.Add(SafeName(lines[i].Substring(0,c)));}e.HeaderNames=string.Join(",",names.ToArray());throw;}
    }
    /// <summary>Parses a request head; reads the body from <paramref name="stream"/> (sending 100 Continue when asked). Public for tests.</summary>
    public static object ParseForTest(string head,Stream stream,out string method,out string path,out byte[] body){Request r=ParseHead(head,stream);method=r.Method;path=r.Path;body=r.Body;return r.Headers;}
    static Request ParseHead(string text,Stream stream){
        string[] lines=text.Split(new[]{"\r\n"},StringSplitOptions.None);string[] first=lines[0].Split(' ');
        if(first.Length!=3||(first[2]!="HTTP/1.1"&&first[2]!="HTTP/1.0"))throw new RequestError(400,"unsupported-request-line","The request line must be 'METHOD /path HTTP/1.1'.");
        // 0.29: RFC 7230 5.3.2 - a server MUST accept the absolute-form target. A local proxy or security product that intercepts
        // loopback HTTP forwards requests this way; 0.26 refused them with HTTP 400 (a candidate cause of the target PC's first-GET 400).
        // Only this host's own loopback authority is accepted, it must equal the Host header, and the request is marked viaProxy.
        string target=first[1];bool absolute=false;string authority=null;
        if(target.StartsWith("http://",StringComparison.OrdinalIgnoreCase)){string rest=target.Substring(7);int slash=rest.IndexOf('/');authority=(slash<0?rest:rest.Substring(0,slash)).ToLowerInvariant();
            if(Array.IndexOf(AllowedHosts(Port),authority)<0)throw new RequestError(400,"proxy-form-target","An absolute request target for another host ('"+SafeName(authority)+"') was refused; only http://127.0.0.1:"+Port+"/ is served.");
            target=slash<0?"/":rest.Substring(slash);absolute=true;first[1]=target;}
        if(!first[1].StartsWith("/",StringComparison.Ordinal)||first[1].Contains("?")||first[1].Contains("%")||first[1].Contains(".."))throw new RequestError(400,"unsupported-request-target","Request paths must be plain /api/... routes without a query string or encoding.");
        if(first[0]!="GET"&&first[0]!="POST")throw new RequestError(405,"method-not-allowed","Only GET and POST are supported.");
        Dictionary<string,string> headers=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
        for(int i=1;i<lines.Length-2;i++){int colon=lines[i].IndexOf(':');if(colon<1)throw new RequestError(400,"malformed-header","Header line "+i+" has no name.");string k=lines[i].Substring(0,colon).Trim();if(headers.ContainsKey(k))throw new RequestError(400,"duplicate-header","Header '"+SafeName(k)+"' was sent twice.");headers[k]=lines[i].Substring(colon+1).Trim();}
        string host;if(!headers.TryGetValue("Host",out host))throw new RequestError(400,"missing-host","The Host header is missing.");
        if(Array.IndexOf(AllowedHosts(Port),host.ToLowerInvariant())<0)throw new RequestError(400,"invalid-host","The Host header must be 127.0.0.1:"+Port+" (received '"+SafeName(host)+"').");
        if(absolute&&authority!=host.ToLowerInvariant())throw new RequestError(400,"host-mismatch","The absolute request target names '"+SafeName(authority)+"' but the Host header says '"+SafeName(host)+"'.");
        if(headers.ContainsKey("Transfer-Encoding"))throw new RequestError(411,"chunked-not-supported","Send the body with a Content-Length header; chunked transfer encoding is not supported.");
        int length=0;string size;if(headers.TryGetValue("Content-Length",out size)&&(!Int32.TryParse(size,NumberStyles.None,CultureInfo.InvariantCulture,out length)||length<0))throw new RequestError(400,"invalid-content-length","Content-Length is not a non-negative integer.");
        if(length>MaxJob)throw new RequestError(413,"body-too-large","Request body exceeds 1 MB.");
        if(first[0]!="POST"&&length!=0)throw new RequestError(400,"body-not-allowed","Only POST requests may carry a body.");
        string expect;if(headers.TryGetValue("Expect",out expect)){
            if(!String.Equals(expect,"100-continue",StringComparison.OrdinalIgnoreCase))throw new RequestError(417,"expectation-failed","Only 'Expect: 100-continue' is supported.");
            if(length>0){byte[] cont=Encoding.ASCII.GetBytes("HTTP/1.1 100 Continue\r\n\r\n");stream.Write(cont,0,cont.Length);stream.Flush();}
        }
        byte[] body=new byte[length];int at=0;while(at<length){int n;try{n=stream.Read(body,at,length-at);}catch(IOException){throw new RequestError(408,"body-timeout","The request body did not arrive within 5 seconds ("+at+" of "+length+" bytes).");}if(n==0)throw new RequestError(400,"incomplete-body","The connection closed after "+at+" of "+length+" body bytes.");at+=n;}
        string step;headers.TryGetValue("X-EightMax-Step",out step);
        bool viaProxy=absolute||headers.ContainsKey("Via")||headers.ContainsKey("X-Forwarded-For")||headers.ContainsKey("Proxy-Connection");
        return new Request{Method=first[0],Path=first[1],Headers=headers,Body=body,Step=step==null?null:SafeName(step),ViaProxy=viaProxy,AbsoluteForm=absolute};
    }
    static string SafeName(string v){if(v==null)return "";StringBuilder b=new StringBuilder();foreach(char c in v){if(b.Length>=80)break;b.Append(c>=32&&c<127?c:'?');}return b.ToString();}
    static string Reason(int status){switch(status){case 100:return "Continue";case 200:return "OK";case 202:return "Accepted";case 400:return "Bad Request";case 403:return "Forbidden";case 404:return "Not Found";case 405:return "Method Not Allowed";case 408:return "Request Timeout";case 409:return "Conflict";case 411:return "Length Required";case 413:return "Payload Too Large";case 417:return "Expectation Failed";case 422:return "Unprocessable Entity";case 431:return "Request Header Fields Too Large";case 500:return "Internal Server Error";case 503:return "Service Unavailable";default:return "Error";}}
    [ThreadStatic] static int lastStatus;
    void Reply(NetworkStream stream,int status,string type,byte[] body){lastStatus=status;string headers="HTTP/1.1 "+status+" "+Reason(status)+"\r\nContent-Type: "+type+"\r\nContent-Length: "+body.Length+"\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; worker-src blob:; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'\r\n\r\n";byte[] head=Encoding.ASCII.GetBytes(headers);stream.Write(head,0,head.Length);stream.Write(body,0,body.Length);}
    /// <summary>Structured error body: "error" (kept for the 0.2x dashboard client) plus code, status, method, path, step and request id.</summary>
    void Fail(NetworkStream stream,Request r,int status,string code,string message){lastCode=code;lastReason=message;JSON(stream,status,new{error=message,code=code,status=status,method=r==null?null:r.Method,path=r==null?null:r.Path,step=r==null?null:r.Step,requestId=r==null?null:r.Id,appVersion=Version});}
    [ThreadStatic] static string lastCode,lastReason;
    // ---- 0.28.0 request diagnostics: method, route, step, status, code, safe reason, duration. Never tokens or bodies. ----
    public sealed class RequestLog {
        public static readonly string FilePath=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"EightMax-Test-Workbench","Logs","desktop-requests.log");
        readonly object sync=new object();readonly List<string> ring=new List<string>();readonly List<string> pending=new List<string>();long counter;
        public string NextId(){return "r"+System.Threading.Interlocked.Increment(ref counter).ToString(CultureInfo.InvariantCulture);}
        public void Add(string id,string method,string path,string step,int status,string code,string reason,double ms){
            string line=DateTime.UtcNow.ToString("o")+" "+id+" "+(method??"-")+" "+(path??"-")+" step="+(step??"-")+" status="+status+" code="+(code??"ok")+" ms="+ms.ToString("0.0",CultureInfo.InvariantCulture)+(reason!=null?" reason="+reason.Replace("\r"," ").Replace("\n"," "):"");
            lock(sync){ring.Add(line);if(ring.Count>200)ring.RemoveAt(0);pending.Add(line);if(pending.Count>=20||status>=400)FlushLocked();}
        }
        public void Note(string code,string reason){Add(NextId(),"-","-",null,0,code,reason,0);}
        public string[] Recent(){lock(sync)return ring.ToArray();}
        public void Flush(){lock(sync)FlushLocked();}
        void FlushLocked(){if(pending.Count==0)return;try{Directory.CreateDirectory(Path.GetDirectoryName(FilePath));if(File.Exists(FilePath)&&new FileInfo(FilePath).Length>1048576){string old=FilePath+".1";if(File.Exists(old))File.Delete(old);File.Move(FilePath,old);}File.AppendAllText(FilePath,string.Join("\r\n",pending.ToArray())+"\r\n",new UTF8Encoding(false));}catch{}pending.Clear();}
    }
    void JSON(NetworkStream stream,int status,object body){byte[] encoded;lock(gate){encoded=Encoding.UTF8.GetBytes(json.Serialize(body));}Reply(stream,status,"application/json; charset=utf-8",encoded);}
    // ---- 0.24 screen capture (explicit, operator-selected window or region; see CaptureService.cs) ----
    CaptureService.Target ReadTarget(Dictionary<string,object> body){
        Dictionary<string,object> t=Obj(Get(body,"target"));string kind=Get(t,"kind") as string;CaptureService.Target x=new CaptureService.Target();x.Kind=kind;
        if(kind=="window"){x.Hwnd=Str(Get(t,"hwnd"),32);object p=Get(t,"pid");x.Pid=p==null?0:Int(p,0,Int32.MaxValue);string title=Get(t,"title") as string;x.Title=title!=null&&title.Length<=300?title:null;}
        else if(kind=="region"){x.X=Int(Get(t,"x"),-32768,32768);x.Y=Int(Get(t,"y"),-32768,32768);x.Width=Int(Get(t,"width"),16,16384);x.Height=Int(Get(t,"height"),16,16384);}
        else throw new Exception("Capture target must be a window or a region.");
        string method=Get(t,"method") as string;x.Method=(method=="print-window"||method=="screen-copy"||method=="windows-graphics-capture")?method:"auto";return x;
    }
    void CaptureRoute(NetworkStream stream,Request r){
        string reply;
        try{
            CaptureService.EnsureDpiAware();
            if(r.Method=="GET"&&r.Path=="/api/capture/windows")reply=CaptureService.ListWindowsJson(System.Diagnostics.Process.GetCurrentProcess().Id);
            else if(r.Method=="GET"&&r.Path=="/api/capture/monitors")reply=CaptureService.ListMonitorsJson();
            else if(r.Method=="GET"&&r.Path=="/api/capture/audit")reply=CaptureService.AuditJson();
            else if(r.Method=="POST"&&r.Path=="/api/capture/open"){
                Dictionary<string,object> body=Obj(Tjson.DeserializeObject(Encoding.UTF8.GetString(r.Body)));
                if(!(Get(body,"consent") is bool)||!(bool)Get(body,"consent"))throw new Exception("Capture needs explicit operator consent for this window or region.");
                reply=CaptureService.OpenJson(ReadTarget(body),"operator-consent");
            }
            else if(r.Method=="POST"&&r.Path=="/api/capture/frame"){CaptureService.Target target=ReadTarget(Obj(Tjson.DeserializeObject(Encoding.UTF8.GetString(r.Body))));
                // 0.28.0: the selected backend is always the one that runs; a Windows Graphics Capture failure is reported as such and never silently replaced by PrintWindow/BitBlt.
                // 0.29: CaptureService.GrabJson dispatches method=="windows-graphics-capture" to GrabWgc (0.27 design: window identity
                // checked BEFORE the helper starts, 8 s limit, result passed through, no fallback to PrintWindow/BitBlt).
                reply=CaptureService.GrabJson(target);}
            else if(r.Method=="POST"&&r.Path=="/api/capture/close"){CaptureService.Target ct=null;try{ct=ReadTarget(Obj(Tjson.DeserializeObject(Encoding.UTF8.GetString(r.Body))));}catch{}int closed=CaptureService.CloseStream(ct);reply="{\"ok\":true,\"closedSessions\":"+closed+"}";}
            else{Fail(stream,r,404,"unknown-route","Unknown capture route.");return;}
        }catch(Exception e){Fail(stream,r,400,"capture-request-invalid",e.Message);return;}
        Reply(stream,200,"application/json; charset=utf-8",Encoding.UTF8.GetBytes(reply));
    }
    // 0.28.0: every request is logged (no token, no body); unexpected exceptions are 500 "internal-error", validation
    // failures stay 400 with their message; the socket is half-closed and drained so a refused request is never reset
    // before the client has read the error body.
    // 0.28.0: connections are served concurrently (at most 8 at once) so an idle socket - e.g. a browser preconnect that
    // never sends a request - can no longer stall every other request, including shutdown, for the read timeout.
    readonly Semaphore connectionSlots=new Semaphore(8,8);
    void ServerLoop(){while(!closing){TcpClient client=null;try{client=listener.AcceptTcpClient();}catch{if(closing)return;continue;}
        if(!connectionSlots.WaitOne(0)){try{using(client){NetworkStream busy=client.GetStream();Fail(busy,null,503,"host-busy","Eight requests are already in progress; retry shortly.");}}catch{}continue;}
        TcpClient accepted=client;ThreadPool.QueueUserWorkItem(delegate{try{Serve(accepted);}finally{connectionSlots.Release();}});}}
    void Serve(TcpClient client){
        using(client){Stopwatch watch=Stopwatch.StartNew();Request r=null;string id=requests.NextId();lastStatus=0;lastCode=null;lastReason=null;NetworkStream stream=null;
            try{stream=client.GetStream();r=ReadRequest(stream);r.Id=id;Route(stream,r);}
            catch(RequestError e){if(r==null&&e.Method!=null)r=new Request{Method=e.Method,Path=e.Path,Id=id};try{Fail(stream,r,e.Status,e.Code,e.Message+(e.HeaderNames!=null?" [headers: "+e.HeaderNames+"]":""));}catch{}}
            catch(Exception e){bool validation=!(e is NullReferenceException||e is InvalidCastException||e is IndexOutOfRangeException||e is ObjectDisposedException||e is OutOfMemoryException);try{Fail(stream,r,validation?400:500,validation?"invalid-request":"internal-error",validation?e.Message:"Unexpected "+e.GetType().Name+" in the desktop host: "+e.Message);}catch{}}
            finally{
                try{requests.Add(id,r==null?null:r.Method,r==null?null:r.Path,r==null?null:r.Step,lastStatus,lastStatus>=400?(lastCode??"error"):null,lastStatus>=400?lastReason:(r!=null&&r.ViaProxy?"via-proxy"+(r.AbsoluteForm?" absolute-form":""):null),watch.Elapsed.TotalMilliseconds);}catch{}
                try{if(stream!=null){stream.Flush();client.Client.Shutdown(SocketShutdown.Send);client.Client.ReceiveTimeout=500;byte[] sink=new byte[4096];int total=0;while(total<MaxJob){int n=client.Client.Receive(sink);if(n<=0)break;total+=n;}}}catch{}
            }}
    }
    int exitStarted;
    void RequestExit(string why){
        if(Interlocked.Exchange(ref exitStarted,1)==1)return;shutdownRequested=true;requests.Note("shutdown",why);
        try{Stop();}catch(Exception e){requests.Note("shutdown-stop-error",e.GetType().Name+": "+e.Message);}
        bool posted=false;
        try{if(window!=null&&window.IsHandleCreated){window.BeginInvoke((Action)delegate{window.Close();});posted=true;}}catch{}
        try{if(!posted&&invoker!=null&&invoker.IsHandleCreated){invoker.BeginInvoke((Action)delegate{context.ExitThread();});posted=true;}}catch{}
        if(!posted)try{Native.PostThreadMessage(uiThread,0x12,IntPtr.Zero,IntPtr.Zero);}catch(Exception e){requests.Note("shutdown-post-quit-error",e.GetType().Name);}
        requests.Flush();
        Thread watchdog=new Thread(delegate(){Thread.Sleep(10000);requests.Note("shutdown-watchdog","message loop did not return within 10 s after cleanup; exiting process");requests.Flush();Environment.Exit(0);});watchdog.IsBackground=true;watchdog.Start();
    }
    // 0.28.0: requests run on several threads; capture routes use a per-thread serializer instead of sharing one instance.
    [ThreadStatic] static JavaScriptSerializer tjson;
    static JavaScriptSerializer Tjson{get{if(tjson==null)tjson=new JavaScriptSerializer{MaxJsonLength=MaxResult,RecursionLimit=64};return tjson;}}
    // ---- 0.28.0 dashboard tools: fixed whitelist of the release's own launchers; nothing else can be started. ----
    static readonly Dictionary<string,string> Tools=new Dictionary<string,string>(StringComparer.Ordinal){{"capture-check","RUN-CAPTURE-CHECK.cmd"},{"wgc-check","RUN-WGC-CHECK.cmd"},{"hardware-check","RUN-HARDWARE-CHECK.cmd"},{"windows-checks","RUN-WINDOWS-CHECKS.cmd"},{"collect-results","COLLECT-TEST-RESULTS.cmd"},{"release-acceptance",null},{"desktop-checks",null},{"open-results-folder",null},{"library-precompute","PRECOMPUTE-STRATEGIES.cmd"},{"library-verify","VERIFY-STRATEGIES.cmd"},{"library-cancel","CANCEL-TRAINING.cmd"},{"library-record","RECORD-SITUATIONS.cmd"},{"library-export","EXPORT-STRATEGIES.cmd"},{"library-import","IMPORT-STRATEGIES.cmd"},{"library-validate","VALIDATE-STRATEGIES.cmd"},{"library-continue","CONTINUE-TRAINING.cmd"},{"library-precompute-common","PRECOMPUTE-COMMON-HANDS.cmd"},{"self-test","RUN-SELF-TEST.cmd"},{"long-acceptance","RUN-LONG-ACCEPTANCE.cmd"},{"view-ranges","VIEW-OPPONENT-RANGES.cmd"},{"preflop-research","RUN-PREFLOP-RESEARCH.cmd"},{"turn-solver-check","RUN-TURN-SOLVER-CHECK.cmd"},{"memory-check","RUN-MEMORY-CHECK.cmd"},{"research-summary","REFRESH-RESEARCH-SUMMARY.cmd"},{"preflop-modes","RUN-PREFLOP-MODES.cmd"},{"flop-solver-check","RUN-FLOP-SOLVER-CHECK.cmd"},{"multiway-validation","RUN-MULTIWAY-VALIDATION.cmd"}};
    string Launch(string tool){
        if(tool==null||!Tools.ContainsKey(tool))throw new RequestError(400,"unknown-tool","Unknown tool. Allowed: "+string.Join(", ",new List<string>(Tools.Keys).ToArray())+".");
        if(tool=="release-acceptance"||tool=="desktop-checks")throw new RequestError(409,"host-must-be-closed","Release and desktop acceptance start their own private desktop host on port "+Port+". Close this desktop host first, then double-click "+(tool=="release-acceptance"?"RUN-RELEASE-ACCEPTANCE.cmd":"RUN-DESKTOP-CHECKS.cmd")+".");
        string folder=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"EightMax-Test-Workbench");
        if(tool=="open-results-folder"){Directory.CreateDirectory(folder);Process.Start(new ProcessStartInfo("explorer.exe","\""+folder+"\""){UseShellExecute=false});return "Opened "+folder;}
        string file=Path.Combine(root,Tools[tool]);if(!File.Exists(file))throw new RequestError(404,"tool-missing",Tools[tool]+" is missing from this release.");
        Process.Start(new ProcessStartInfo(file){UseShellExecute=true,WorkingDirectory=root});requests.Note("launch",tool);return "Started "+Tools[tool]+" in its own window.";
    }
    /// <summary>Latest test results via Collect-TestResults.ps1 -SummaryOnly (same parser as the ZIP collector), bounded to 60 s.</summary>
    string TestResultsSummary(){
        string script=Path.Combine(root,"windows","Collect-TestResults.ps1");
        ProcessStartInfo psi=new ProcessStartInfo(Path.Combine(Environment.SystemDirectory,"WindowsPowerShell","v1.0","powershell.exe"),"-NoLogo -NoProfile -ExecutionPolicy Bypass -File \""+script+"\" -SummaryOnly -NoUi"){UseShellExecute=false,RedirectStandardOutput=true,RedirectStandardError=true,CreateNoWindow=true};
        using(Process p=Process.Start(psi)){System.Threading.Tasks.Task<string> err=p.StandardError.ReadToEndAsync();System.Threading.Tasks.Task<string> output=p.StandardOutput.ReadToEndAsync();
            if(!p.WaitForExit(60000)){try{p.Kill();}catch{}throw new RequestError(504,"summary-timeout","Reading the test reports took longer than 60 s.");}
            string text=output.Result.Trim();int at=text.LastIndexOf("\n{",StringComparison.Ordinal);if(at>=0)text=text.Substring(at+1);
            if(p.ExitCode!=0||!text.StartsWith("{",StringComparison.Ordinal))throw new RequestError(500,"summary-failed","The results summary failed: "+SafeName(err.Result));return text;}
    }
    static string LibraryDir(){string env=Environment.GetEnvironmentVariable("EIGHTMAX_STRATEGY_LIBRARY");return string.IsNullOrEmpty(env)?Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"EightMax-Test-Workbench","StrategyLibrary"):env;}
    string LibraryStatus(){
        string file=Path.Combine(LibraryDir(),"status.json");
        if(!File.Exists(file))return json.Serialize(new{format="eightmax-strategy-library-status",version=1,available=false,dir=LibraryDir(),message="No strategy library status yet. Use Precompute Strategies or Verify Strategies to create it."});
        string text;try{text=File.ReadAllText(file,new UTF8Encoding(false,true));}catch(Exception e){throw new RequestError(500,"library-status-unreadable","The strategy library status file could not be read: "+SafeName(e.Message));}
        text=text.Trim();if(!text.StartsWith("{",StringComparison.Ordinal)||text.Length>4000000)throw new RequestError(500,"library-status-invalid","The strategy library status file is not a status report.");
        return text;
    }
    /// <summary>0.31: read-only JSON written by the tools (strategy quality summary, latest opponent-range views). Never executed, only validated as a JSON object.</summary>
    string ToolJson(string file,string format,string missingMessage){
        if(!File.Exists(file))return json.Serialize(new{format=format,version=1,available=false,file=file,message=missingMessage});
        string text;try{text=File.ReadAllText(file,new UTF8Encoding(false,true));}catch(Exception e){throw new RequestError(500,"tool-json-unreadable","The file could not be read: "+SafeName(e.Message));}
        text=text.Trim();if(!text.StartsWith("{",StringComparison.Ordinal)||text.Length>8000000)throw new RequestError(500,"tool-json-invalid","The file is not a report.");
        return text;
    }
    static string AppDataDir(){return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"EightMax-Test-Workbench");}
    bool WgcHelperPresent(){return CaptureService.WgcInstalled();}
    string[] CaptureMethods(){return WgcHelperPresent()?new[]{"print-window","screen-copy","windows-graphics-capture"}:new[]{"print-window","screen-copy"};}
    void Route(NetworkStream stream,Request r){
        if(r.Method=="GET"&&(r.Path=="/"||r.Path=="/START.html")){Reply(stream,200,"text/html; charset=utf-8",File.ReadAllBytes(Path.Combine(root,"START.html")));return;}
        string supplied,origin;if(!r.Headers.TryGetValue("X-EightMax-Session",out supplied)||!SecureEqual(supplied,token)||r.Headers.TryGetValue("Origin",out origin)&&origin!="http://127.0.0.1:"+Port){Fail(stream,r,403,"session-required","This route needs the current local desktop session (missing/wrong X-EightMax-Session header or a foreign Origin).");return;}
        if(shutdownRequested&&!(r.Method=="GET"&&r.Path=="/api/desktop/health")){Fail(stream,r,503,"host-stopping","The desktop host is shutting down and accepts no new work.");return;}
        if(r.Method=="GET"&&r.Path=="/api/desktop/health"){JSON(stream,200,new{format="eightmax-desktop-health",version=1,appVersion=Version,build=Build,nativeCPU=true,liveClientConnected=false,screenCapture=true,captureMethods=CaptureMethods(),testResults=true,strategyLibrary=true,strategyQuality=true,opponentRanges=true,launchTools=new List<string>(Tools.Keys).ToArray(),windowsGraphicsCapture=CaptureService.WgcInstalled(),windowsGraphicsCaptureVerified=false,persistentCaptureSessions=true,activeCaptureSessions=CaptureService.StreamCount,structuredErrors=true,requestLog=true,gracefulShutdown=true,stopping=shutdownRequested,currentJob=true,cancelIntents=true,revisionedJobs=true,idempotentJobs=true,maxBindings=MaxBindings,maxRevision=MaxRevision,nativeHistory=true,nativeBatches=true,maxBatchJobs=10,request=new{viaProxy=r.ViaProxy,absoluteForm=r.AbsoluteForm,requestId=r.Id}});return;}
        // 0.30: strategy-library status for the dashboard. Read-only: the file is written by tools\strategy-library.cjs (status, verify, precompute).
        if(r.Method=="GET"&&r.Path=="/api/library/status"){Reply(stream,200,"application/json; charset=utf-8",Encoding.UTF8.GetBytes(LibraryStatus()));return;}
        // 0.31: strategy quality summary (written by tools\strategy-library.cjs quality) and the latest opponent-range views (written by simulate).
        if(r.Method=="GET"&&r.Path=="/api/library/quality"){Reply(stream,200,"application/json; charset=utf-8",Encoding.UTF8.GetBytes(ToolJson(Path.Combine(LibraryDir(),"quality-summary.json"),"eightmax-strategy-quality-summary","No quality summary yet. Use Validate Strategies to create it.")));return;}
        // 0.33.0: research summary (0.32 keys + v033: preflop modes, flop solver, multiway validation, calibration) written by tools\research-summary-033.cjs
        if(r.Method=="GET"&&r.Path=="/api/research/summary"){Reply(stream,200,"application/json; charset=utf-8",Encoding.UTF8.GetBytes(ToolJson(Path.Combine(AppDataDir(),"research-summary.json"),"eightmax-research-summary","No research summary yet. Use Refresh Research Summary (REFRESH-RESEARCH-SUMMARY.cmd).")));return;}
        if(r.Method=="GET"&&r.Path=="/api/ranges/latest"){Reply(stream,200,"application/json; charset=utf-8",Encoding.UTF8.GetBytes(ToolJson(Path.Combine(AppDataDir(),"ranges-latest.json"),"eightmax-range-views","No opponent ranges recorded yet. Use View Opponent Ranges (plays simulated hands with derived ranges).")));return;}
        if(r.Method=="GET"&&r.Path=="/api/desktop/test-results"){Reply(stream,200,"application/json; charset=utf-8",Encoding.UTF8.GetBytes(TestResultsSummary()));return;}
        if(r.Method=="POST"&&r.Path=="/api/desktop/launch"){Dictionary<string,object> body=Obj(Tjson.DeserializeObject(new UTF8Encoding(false,true).GetString(r.Body)));if(body.Count!=1)throw new RequestError(400,"invalid-launch","Send {\"tool\":name} only.");string tool=Get(body,"tool") as string;string message=Launch(tool);JSON(stream,200,new{format="eightmax-desktop-launch",version=1,tool=tool,started=true,message=message});return;}
        if(r.Method=="GET"&&r.Path=="/api/desktop/requests"){JSON(stream,200,new{format="eightmax-desktop-requests",version=1,appVersion=Version,file=RequestLog.FilePath,entries=requests.Recent()});return;}
        if(r.Method=="POST"&&r.Path=="/api/desktop/shutdown"){
            // 0.28.0 graceful shutdown: refuse new work, answer, stop native work (job objects kill mwcli), close the listener,
            // flush logs, then end the UI message loop through the invoker control (WM_QUIT kept as a fallback). A watchdog
            // ends the process only if the message loop has not returned 10 s after cleanup; it is logged when it fires.
            bool running;lock(gate){running=current!=null&&current.Running;}shutdownRequested=true;
            JSON(stream,200,new{ok=true,format="eightmax-desktop-shutdown",version=1,stopping=true,nativeWorkStopped=running});
            ThreadPool.QueueUserWorkItem(delegate{Thread.Sleep(50);try{RequestExit("authenticated shutdown request");}catch(Exception e){try{requests.Note("shutdown-error",e.GetType().Name+": "+e.Message);requests.Flush();}catch{}Environment.Exit(0);}});return;}
        if(r.Path.StartsWith("/api/capture/",StringComparison.Ordinal)){CaptureRoute(stream,r);return;}
        lock(gate){
            Tick();if(ArchiveRoute(stream,r))return;
            if(r.Method=="GET"&&r.Path=="/api/native/current"){JSON(stream,200,CurrentView());return;}
            if(r.Method=="POST"&&(r.Path=="/api/native/jobs"||r.Path=="/api/native/cancel-intent")){
                string text,key,hash;Dictionary<string,object> job=ReadJob(r,out text,out key,out hash);string known;
                if(submissions.TryGetValue(key,out known)&&known!=hash){Fail(stream,r,409,"conflict","This native binding was already used for different job settings.");return;}
                if(r.Path=="/api/native/cancel-intent"){
                    string requested;int rev;if(!r.Headers.TryGetValue("X-EightMax-Revision",out requested)||!Int32.TryParse(requested,out rev)||rev<1||rev>MaxRevision)throw new Exception("Cancellation intent needs an attempt revision.");
                    // With a full ledger all unknown bindings are already refused, so an
                    // unknown intent can be confirmed without evicting an earlier fence.
                    if(!submissions.ContainsKey(key)&&submissions.Count<MaxBindings)submissions.Add(key,hash);
                    if(submissions.ContainsKey(key))cancelledAttempts.Add(AttemptKey(key,rev));
                    if(current!=null&&current.Binding==key){
                        if(current.Revision==rev)StopBatch("Cancelled by submission intent.");
                        else if(rev==current.Revision+1&&current.CanResume)current.SkipAttempt(rev);
                    }
                    JSON(stream,200,new{format="eightmax-desktop-cancel-intent",version=1,binding=Get(job,"workbench"),revision=rev,fenced=true,current=CurrentView()});return;
                }
                if(submissions.ContainsKey(key)){
                    if(current!=null&&current.Binding==key){JSON(stream,200,current.View());return;}
                    Fail(stream,r,409,"conflict",cancelledAttempts.Contains(AttemptKey(key,1))?"This submission was cancelled before it could start.":"This older submission binding cannot be run again; recover its saved files.");return;
                }
                if(submissions.Count>=MaxBindings){JSON(stream,503,new{error="Desktop submission ledger is full; close the host before starting a new session."});return;}
                if(batch!=null&&batch.Stage=="running"){Fail(stream,r,409,"conflict","A native batch is running; stop it before starting another study.");return;}
                submissions.Add(key,hash);
                if(current!=null&&current.Running){cancelledAttempts.Add(AttemptKey(key,1));Fail(stream,r,409,"conflict","A managed native study is already running.");return;}
                current=new NativeRun(root,data,text,job,json,key,hash);try{current.Start(null,1);}catch(Exception e){current.Fail(e.Message);}JSON(stream,202,current.View());return;
            }
            string prefix=current==null?"":("/api/native/jobs/"+current.Id);
            if(current!=null&&r.Path==prefix&&r.Method=="GET"){JSON(stream,200,current.View());return;}
            if(current!=null&&r.Path==prefix+"/cancel"&&r.Method=="POST"){
                int expected=ReadRevisionBody(r);if(expected!=current.Revision){Fail(stream,r,409,"conflict","The managed attempt changed; find the current study before cancelling.");return;}
                cancelledAttempts.Add(AttemptKey(current.Binding,expected));StopBatch("Stopped from dashboard.");JSON(stream,200,current.View());return;
            }
            if(current!=null&&r.Path==prefix+"/resume"&&r.Method=="POST"){
                if(batch!=null&&batch.Stage=="running")throw new Exception("Stop the batch before resuming a single study.");int expected=ReadRevisionBody(r);
                if(expected+1==current.Revision){JSON(stream,200,current.View());return;}
                if(expected!=current.Revision||expected>=MaxRevision||!current.CanResume){Fail(stream,r,409,"conflict","No unchanged completed checkpoint/attempt is available for resume.");return;}
                if(cancelledAttempts.Contains(AttemptKey(current.Binding,expected+1)))current.SkipAttempt(expected+1);
                else try{current.Start(current.Checkpoint,expected+1);}catch(Exception e){current.Fail(e.Message);}
                JSON(stream,202,current.View());return;
            }
            if(current!=null&&r.Path==prefix+"/result"&&r.Method=="GET"){if(current.Stage!="complete"){Fail(stream,r,409,"conflict","No completed result is ready.");return;}Reply(stream,200,"application/json; charset=utf-8",ReadBounded(current.ResultFile,MaxResult));return;}
            Fail(stream,r,404,"unknown-route","Unknown desktop route or expired managed job.");
        }
    }
    static bool HexId(string id){if(id==null||id.Length!=32)return false;foreach(char c in id)if(!(c>='0'&&c<='9'||c>='a'&&c<='f'))return false;return true;}
    static bool HexHash(string hash){if(hash==null||hash.Length!=64)return false;foreach(char c in hash)if(!(c>='0'&&c<='9'||c>='a'&&c<='f'))return false;return true;}
    static void AtomicWrite(string path,string text){string tmp=path+"."+Guid.NewGuid().ToString("N")+".tmp";try{Write(tmp,text);if(File.Exists(path))File.Replace(tmp,path,null);else File.Move(tmp,path);}finally{try{File.Delete(tmp);}catch{}}}
    string ArchivePath(string id){if(!HexId(id))throw new Exception("Invalid saved study identity.");return Path.Combine(data,"Archive","job-"+id+".json");}
    static string SafeWork(string data,string work){if(work==null||!work.StartsWith("desktop-",StringComparison.Ordinal)||!HexId(work.Substring(8)))throw new Exception("Invalid managed folder.");string path=Path.Combine(data,work);if(!Directory.Exists(path)||(File.GetAttributes(path)&FileAttributes.ReparsePoint)!=0)throw new Exception("Managed folder is missing or redirected.");return path;}
    static string SafeCheckpoint(string data,string path){
        if(String.IsNullOrEmpty(path))return "";string full=Path.GetFullPath(Path.IsPathRooted(path)?path:Path.Combine(data,path));string folder=Path.GetDirectoryName(full),name=Path.GetFileName(full);
        if(name!="checkpoint-0.state"&&name!="checkpoint-1.state")throw new Exception("Unknown completed checkpoint name.");if(!String.Equals(Path.GetDirectoryName(folder),Path.GetFullPath(data),StringComparison.OrdinalIgnoreCase))throw new Exception("Checkpoint outside managed storage.");SafeWork(data,Path.GetFileName(folder));if(!File.Exists(full)||(File.GetAttributes(full)&FileAttributes.ReparsePoint)!=0)throw new Exception("Checkpoint is missing or redirected.");return full;
    }
    NativeRun LoadSaved(string id,out string etag){
        string path=ArchivePath(id);if((File.GetAttributes(path)&FileAttributes.ReparsePoint)!=0)throw new Exception("Saved record is redirected.");byte[] bytes=ReadBounded(path,1200000);using(SHA256 h=SHA256.Create())etag=Hex(h.ComputeHash(bytes));
        Dictionary<string,object> record=Obj(json.DeserializeObject(new UTF8Encoding(false,true).GetString(bytes)));if((string)Get(record,"format")!="eightmax-native-archive"||Int(Get(record,"version"),1,1)!=1||(string)Get(record,"build")!=Build||(string)Get(record,"id")!=id)throw new Exception("Unsupported saved study record.");
        Dictionary<string,object> job=Obj(Get(record,"job"));ValidateJob(job);string hash=JobHash(job);if(hash!=(string)Get(record,"jobHash"))throw new Exception("Saved job identity changed.");
        Dictionary<string,object> s=Obj(Get(record,"status"));if((string)Get(s,"format")!="eightmax-desktop-job"||Int(Get(s,"version"),2,2)!=2||(string)Get(s,"id")!=id||!SameBinding(Get(s,"binding"),Get(job,"workbench"))||Int(Get(s,"targetUpdates"),1,MaxUpdates)!=Int(Get(job,"iterations"),1,MaxUpdates))throw new Exception("Saved status belongs to another study.");
        string work=SafeWork(data,Str(Get(record,"work"),80));NativeRun run=new NativeRun(root,data,json.Serialize(job),job,json,BindingKey(job),hash,id);run.Revision=Int(Get(s,"revision"),1,MaxRevision);run.Work=work;run.ResultFile=Path.Combine(work,"result.native-result.json");run.SavedAt=Str(Get(record,"savedAtUtc"),40);
        string stage=Str(Get(s,"stage"),20);if(stage!="complete"&&stage!="cancelled"&&stage!="failed"&&stage!="starting"&&stage!="restoring"&&stage!="training"&&stage!="querying")throw new Exception("Invalid saved stage.");run.Stage=stage=="complete"&&File.Exists(run.ResultFile)?"complete":stage=="failed"?"failed":"cancelled";run.Message=run.Stage=="complete"?"Saved native result is ready to validate.":"Saved study opened without training. Resume its completed checkpoint explicitly.";
        string cp=Get(record,"checkpoint") as string;if(!String.IsNullOrEmpty(cp)){try{run.Checkpoint=SafeCheckpoint(data,cp);}catch{run.Checkpoint="";}}
        run.ReadSnapshot(false);if(run.Stage=="complete")run.ReadQuality();return run;
    }
    object SavedView(string id){string etag;NativeRun run=LoadSaved(id,out etag);if(current!=null&&current.Id==id)run=current;return new{format="eightmax-native-saved-job",version=1,id=id,etag=etag,savedAtUtc=run.SavedAt,job=run.Job,status=run.View(),quality=run.QualityView()};}
    object HistoryView(){
        DirectoryInfo folder=new DirectoryInfo(Path.Combine(data,"Archive"));List<FileInfo> files=new List<FileInfo>();int scanned=0;foreach(FileInfo f in folder.EnumerateFiles("job-*.summary.json")){if(++scanned>4096)break;files.Add(f);}files.Sort(delegate(FileInfo a,FileInfo b){return b.LastWriteTimeUtc.CompareTo(a.LastWriteTimeUtc);});List<object> items=new List<object>();int invalid=0;
        foreach(FileInfo file in files){if(items.Count>=128)break;try{if((file.Attributes&FileAttributes.ReparsePoint)!=0)throw new Exception();Dictionary<string,object> s=Obj(json.DeserializeObject(Encoding.UTF8.GetString(ReadBounded(file.FullName,6000))));string id=Get(s,"id") as string;if(!HexId(id)||file.Name!="job-"+id+".summary.json"||(string)Get(s,"format")!="eightmax-native-saved-summary"||(string)Get(s,"build")!=Build)throw new Exception();Int(Get(s,"version"),1,1);Int(Get(s,"revision"),1,MaxRevision);Int(Get(s,"slot"),1,10);int target=Int(Get(s,"targetUpdates"),1,MaxUpdates),committed=Int(Get(s,"committedUpdates"),0,target);foreach(string field in new[]{"running","resumable","resultAvailable","limitReached","partial"})if(!(Get(s,field) is bool))throw new Exception();string stage=Get(s,"stage") as string;bool live=stage=="starting"||stage=="restoring"||stage=="training"||stage=="querying";if(!live&&stage!="complete"&&stage!="cancelled"&&stage!="failed"||(bool)Get(s,"running")!=live||(bool)Get(s,"resultAvailable")!=(stage=="complete")||(bool)Get(s,"partial")!=(stage=="complete"&&committed<target)||(bool)Get(s,"resumable")&&stage!="cancelled"&&stage!="failed")throw new Exception();DateTime time;if(!DateTime.TryParse(Str(Get(s,"savedAtUtc"),40),CultureInfo.InvariantCulture,DateTimeStyles.RoundtripKind,out time))throw new Exception();if(Object.Equals(Get(s,"running"),true)&&(current==null||current.Id!=id)){s["running"]=false;s["stage"]="cancelled";}items.Add(s);}catch{invalid++;}}
        return new{format="eightmax-native-history",version=1,items=items.ToArray(),invalid=invalid,truncated=files.Count>128||scanned>4096};
    }
    object ImportLegacy(){
        List<DirectoryInfo> dirs=new List<DirectoryInfo>();int scanned=0,imported=0,invalid=0;foreach(DirectoryInfo d in new DirectoryInfo(data).EnumerateDirectories("desktop-*")){if(++scanned>4096)break;if((d.Attributes&FileAttributes.ReparsePoint)==0)dirs.Add(d);}dirs.Sort(delegate(DirectoryInfo a,DirectoryInfo b){return b.LastWriteTimeUtc.CompareTo(a.LastWriteTimeUtc);});
        int examined=0;foreach(DirectoryInfo dir in dirs){if(examined++>=64)break;try{string file=Path.Combine(dir.FullName,"desktop-status.json");Dictionary<string,object> s=Obj(json.DeserializeObject(Encoding.UTF8.GetString(ReadBounded(file,20000))));string id=Get(s,"id") as string;if(!HexId(id)||Int(Get(s,"version"),1,2)!=2)throw new Exception();if(File.Exists(ArchivePath(id)))continue;Dictionary<string,object> job=Obj(json.DeserializeObject(Encoding.UTF8.GetString(ReadBounded(Path.Combine(dir.FullName,"job.json"),MaxJob))));ValidateJob(job);if(!SameBinding(Get(s,"binding"),Get(job,"workbench")))throw new Exception();
            NativeRun run=new NativeRun(root,data,json.Serialize(job),job,json,BindingKey(job),JobHash(job),id);run.Work=SafeWork(data,dir.Name);run.ResultFile=Path.Combine(run.Work,"result.native-result.json");run.Revision=Int(Get(s,"revision"),1,MaxRevision);run.Stage=(string)Get(s,"stage")=="complete"&&File.Exists(run.ResultFile)?"complete":"cancelled";run.Message="Imported prior managed job; no training started.";run.ReadSnapshot(false);if(run.Stage=="complete")run.ReadQuality();run.Persist(true);imported++;
        }catch{invalid++;}}
        return new{format="eightmax-native-import",version=1,examined=Math.Min(examined,64),imported=imported,invalid=invalid,truncated=dirs.Count>64||scanned>4096};
    }
    string BatchPath(string id){if(!HexId(id))throw new Exception("Invalid batch identity.");return Path.Combine(data,"Archive","batch-"+id+".json");}
    void SaveBatch(){if(batch==null)return;string text=json.Serialize(batch.View());if(Encoding.UTF8.GetByteCount(text)>1200000)throw new Exception("Saved batch metadata exceeds its limit.");AtomicWrite(BatchPath(batch.Id),text);AtomicWrite(Path.Combine(data,"Archive","last-batch.txt"),batch.Id);}
    void LoadLastBatch(){try{string id=Encoding.UTF8.GetString(ReadBounded(Path.Combine(data,"Archive","last-batch.txt"),32));batch=ReadBatch(id);if(batch.Stage=="running"){batch.Stage="paused";batch.Message="Previous host session ended. No queued work restarts automatically.";foreach(BatchItem item in batch.Items)if(item.Stage=="running")item.Stage="interrupted";SaveBatch();}}catch{batch=null;}}
    NativeBatch ReadBatch(string id){Dictionary<string,object> b=Obj(json.DeserializeObject(Encoding.UTF8.GetString(ReadBounded(BatchPath(id),1200000))));if((string)Get(b,"format")!="eightmax-native-batch-status"||Int(Get(b,"version"),1,1)!=1||(string)Get(b,"id")!=id||(string)Get(b,"build")!=Build)throw new Exception("Invalid saved batch.");NativeBatch next=new NativeBatch();next.Id=id;next.Hash=Str(Get(b,"requestHash"),64);next.Stage=Str(Get(b,"stage"),20);if(next.Stage!="running"&&next.Stage!="paused"&&next.Stage!="complete"&&next.Stage!="cancelled"&&next.Stage!="failed")throw new Exception("Unknown saved batch stage.");next.Message=Str(Get(b,"message"),2000);object[] items=Arr(Get(b,"items"),10);if(items.Length<1)throw new Exception("Empty saved batch.");foreach(object v in items){Dictionary<string,object> row=Obj(v),job=Obj(Get(row,"job"));ValidateJob(job);BatchItem item=new BatchItem();item.Job=job;item.Stage=Str(Get(row,"stage"),20);if(item.Stage!="queued"&&item.Stage!="running"&&item.Stage!="complete"&&item.Stage!="cancelled"&&item.Stage!="failed"&&item.Stage!="interrupted")throw new Exception("Invalid batch item stage.");item.ArchiveId=Get(row,"archiveId") as string;if(item.ArchiveId!=null&&!HexId(item.ArchiveId))throw new Exception("Invalid batch archive identity.");item.Updates=Int(Get(row,"updates"),0,Int(Get(job,"iterations"),1,MaxUpdates));item.Limit=Object.Equals(Get(row,"limitReached"),true);next.Items.Add(item);}if(!HexHash(next.Hash)||JobHash(json.DeserializeObject(json.Serialize(new{format="eightmax-native-batch",version=1,id=id,jobs=BatchJobs(next)})))!=next.Hash)throw new Exception("Saved batch settings changed.");return next;}
    object[] BatchJobs(NativeBatch value){List<object> jobs=new List<object>();foreach(BatchItem item in value.Items)jobs.Add(item.Job);return jobs.ToArray();}
    object BatchCurrent(){return batch==null?(object)new{format="eightmax-native-batch-current",version=1,batch=(object)null}:new{format="eightmax-native-batch-current",version=1,batch=batch.View()};}
    void StopBatch(string message){if(batch!=null&&batch.Stage=="running"){batch.Stage="cancelled";batch.Message=message;foreach(BatchItem item in batch.Items)if(item.Stage=="running"||item.Stage=="queued")item.Stage="cancelled";if(current!=null)current.Cancel(message);SaveBatch();}else if(current!=null)current.Cancel(message);}
    void Tick(){
        if(closing)return;if(current!=null)current.Refresh();if(batch==null||batch.Stage!="running")return;
        BatchItem active=null;foreach(BatchItem item in batch.Items)if(item.Stage=="running"){active=item;break;}
        if(active!=null){if(current==null||current.Id!=active.ArchiveId)throw new Exception("Batch lost its managed job identity.");if(current.Running)return;current.ReadQuality();active.Updates=current.Updates;active.Limit=current.Limit;
            if(current.Stage!="complete"||!current.ArchiveOK||current.Updates!=Int(Get(active.Job,"iterations"),1,MaxUpdates)||current.Limit){active.Stage=current.Stage=="cancelled"?"cancelled":"failed";batch.Stage="failed";batch.Message="Batch halted: a study failed, was cancelled or did not reach its update target. Completed files/checkpoints were kept.";SaveBatch();return;}active.Stage="complete";SaveBatch();}
        BatchItem queued=null;foreach(BatchItem item in batch.Items)if(item.Stage=="queued"){queued=item;break;}
        if(queued==null){batch.Stage="complete";batch.Message="All batch study results were saved.";SaveBatch();return;}
        string key=BindingKey(queued.Job),hash=JobHash(queued.Job);if(submissions.ContainsKey(key)||submissions.Count>=MaxBindings){queued.Stage="failed";batch.Stage="failed";batch.Message="A queued binding was used/cancelled or the session ledger is full.";SaveBatch();return;}
        submissions.Add(key,hash);current=new NativeRun(root,data,json.Serialize(queued.Job),queued.Job,json,key,hash);queued.ArchiveId=current.Id;queued.Stage="running";SaveBatch();try{current.Start(null,1);}catch(Exception e){current.Fail(e.Message);}SaveBatch();
    }
    void BackgroundTick(object state){lock(gate){try{Tick();}catch(Exception e){if(batch!=null&&batch.Stage=="running"){batch.Stage="failed";batch.Message="Batch stopped: "+e.Message.Substring(0,Math.Min(1500,e.Message.Length));if(current!=null)current.Cancel(batch.Message);try{SaveBatch();}catch{}}}}}
    bool ArchiveRoute(NetworkStream stream,Request r){
        if(r.Path=="/api/native/history"&&r.Method=="GET"){JSON(stream,200,HistoryView());return true;}
        if(r.Path=="/api/native/history/import"&&r.Method=="POST"){if(current!=null&&current.Running||batch!=null&&batch.Stage=="running")throw new Exception("Stop native work before importing prior folders.");JSON(stream,200,ImportLegacy());return true;}
        string prefix="/api/native/history/";if(r.Path.StartsWith(prefix,StringComparison.Ordinal)){string suffix=r.Path.Substring(prefix.Length),id=suffix.Split('/')[0];if(!HexId(id))throw new Exception("Invalid saved study id.");if(suffix==id&&r.Method=="GET"){JSON(stream,200,SavedView(id));return true;}
            if(suffix==id+"/open"&&r.Method=="POST"){if(current!=null&&current.Running||batch!=null&&batch.Stage=="running")throw new Exception("Stop native work before opening a saved study.");Dictionary<string,object> body=Obj(json.DeserializeObject(Encoding.UTF8.GetString(r.Body)));if(body.Count!=1||!HexHash(Get(body,"etag") as string))throw new Exception("Saved study requires its unchanged record token.");string etag;NativeRun restored=LoadSaved(id,out etag);if(etag!=(string)Get(body,"etag")){Fail(stream,r,409,"conflict","The saved study changed; refresh it before opening.");return true;}string known;if(submissions.TryGetValue(restored.Binding,out known)&&known!=restored.BodyHash)throw new Exception("Saved binding differs from this session.");if(!submissions.ContainsKey(restored.Binding)){if(submissions.Count>=MaxBindings)throw new Exception("Session ledger is full.");submissions.Add(restored.Binding,restored.BodyHash);}current=restored;JSON(stream,200,CurrentView());return true;}}
        if(r.Path=="/api/native/batch"&&r.Method=="GET"){JSON(stream,200,BatchCurrent());return true;}
        if(r.Path=="/api/native/batch"&&r.Method=="POST"){
            Dictionary<string,object> b=Obj(json.DeserializeObject(new UTF8Encoding(false,true).GetString(r.Body)));if(b.Count!=4||(string)Get(b,"format")!="eightmax-native-batch"||Int(Get(b,"version"),1,1)!=1||!HexId(Get(b,"id") as string))throw new Exception("Unsupported native batch.");string id=(string)Get(b,"id"),hash=JobHash(b);if(batchFences.Contains(id)){Fail(stream,r,409,"conflict","This batch was cancelled before submission.");return true;}
            if(File.Exists(BatchPath(id))){NativeBatch old=ReadBatch(id);if(old.Hash!=hash)throw new Exception("Batch id was used for different studies.");JSON(stream,200,batch!=null&&batch.Id==id?batch.View():old.View());return true;}
            if(current!=null&&current.Running||batch!=null&&batch.Stage=="running")throw new Exception("Native work is already running.");if(batchFences.Count>=MaxBindings)throw new Exception("Batch submission ledger is full; start a new host session.");object[] items=Arr(Get(b,"jobs"),10);if(items.Length<1||submissions.Count+items.Length>MaxBindings)throw new Exception("Batch needs 1-10 studies and enough free session bindings.");HashSet<int> slots=new HashSet<int>();HashSet<string> keys=new HashSet<string>();NativeBatch next=new NativeBatch();next.Id=id;next.Hash=hash;next.Stage="running";next.Message="Sequential batch running. Results are saved after each study.";
            foreach(object v in items){Dictionary<string,object> job=Obj(v);ValidateJob(job);string key=BindingKey(job);if(!slots.Add(Int(Get(Obj(Get(job,"workbench")),"slot"),1,10))||!keys.Add(key)||submissions.ContainsKey(key))throw new Exception("Batch requires fresh bindings and unique slots.");BatchItem item=new BatchItem();item.Job=job;next.Items.Add(item);}batch=next;SaveBatch();Tick();JSON(stream,202,batch.View());return true;
        }
        prefix="/api/native/batch/";if(r.Path.StartsWith(prefix,StringComparison.Ordinal)&&r.Path.EndsWith("/cancel",StringComparison.Ordinal)&&r.Method=="POST"){
            string id=r.Path.Substring(prefix.Length,r.Path.Length-prefix.Length-7);if(!HexId(id))throw new Exception("Invalid batch id.");if(batchFences.Count<MaxBindings)batchFences.Add(id);if(batch!=null&&batch.Id==id&&batch.Stage=="running")StopBatch("Stopped sequential batch.");JSON(stream,200,new{format="eightmax-native-batch-cancel",version=1,id=id,cancelled=true,current=BatchCurrent()});return true;
        }return false;
    }
    sealed class BatchItem {public Dictionary<string,object> Job;public string Stage="queued",ArchiveId=null;public int Updates;public bool Limit;public object View(){return new{job=Job,stage=Stage,archiveId=ArchiveId,updates=Updates,limitReached=Limit};}}
    sealed class NativeBatch {public string Id,Hash,Stage,Message;public List<BatchItem> Items=new List<BatchItem>();public object View(){List<object> rows=new List<object>();foreach(BatchItem item in Items)rows.Add(item.View());return new{format="eightmax-native-batch-status",version=1,build=Build,id=Id,requestHash=Hash,stage=Stage,running=Stage=="running",items=rows.ToArray(),message=Message};}}

    static byte[] ReadBounded(string path,int limit){FileInfo info=new FileInfo(path);if(!info.Exists||info.Length>limit||(info.Attributes&FileAttributes.ReparsePoint)!=0)throw new Exception("Managed output missing or oversized.");byte[] b=File.ReadAllBytes(path);if(b.Length>limit)throw new Exception("Managed output exceeded its bound.");return b;}
    static bool SameBinding(object a,object b){Dictionary<string,object>x=Obj(a),y=Obj(b);return Int(Get(x,"slot"),1,10)==Int(Get(y,"slot"),1,10)&&(string)Get(x,"token")== (string)Get(y,"token");}
    static bool SecureEqual(string a,string b){int x=a.Length^b.Length;for(int i=0;i<Math.Min(a.Length,b.Length);i++)x|=a[i]^b[i];return x==0;}
    sealed class NativeRun {
        readonly string root,data,input;readonly Dictionary<string,object> job;readonly JavaScriptSerializer json;
        public readonly string Binding,BodyHash,Id;public int Revision,Updates;public bool Limit;
        public string Stage="starting",Message="Preparing native CPU study.",Checkpoint="",ResultFile="",Work="",SavedAt="";
        public bool Running,ArchiveOK;public Dictionary<string,object> Snapshot;ContainedProcess child;
        public Dictionary<string,object> Job {get{return job;}}
        public NativeRun(string rootPath,string dataPath,string jobJSON,Dictionary<string,object> jobValue,JavaScriptSerializer serializer,string binding,string bodyHash,string id=null){root=rootPath;data=dataPath;input=jobJSON;job=jobValue;json=serializer;Binding=binding;BodyHash=bodyHash;Id=id??Guid.NewGuid().ToString("N");}
        public bool CanResume {get{return !Running&&(Stage=="cancelled"||Stage=="failed")&&Checkpoint.Length>0&&File.Exists(Checkpoint);}}
        public void Start(string checkpoint,int revision){
            Revision=revision;Work=Path.Combine(data,"desktop-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(Work);Write(Path.Combine(Work,"job.json"),input);ResultFile=Path.Combine(Work,"result.native-result.json");Snapshot=null;Updates=0;Limit=false;Stage=checkpoint==null?"starting":"restoring";Message=checkpoint==null?"Native study starting.":"Restoring the last completed checkpoint.";
            Running=true;Persist(true);string powershell=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell","v1.0","powershell.exe");
            List<string> args=new List<string>(new[]{"-NoLogo","-NoProfile","-ExecutionPolicy","Bypass","-STA","-File",Path.Combine(root,"native","Run-Native-Study.ps1"),"-Headless","-JobFile",Path.Combine(Work,"job.json"),"-WorkDirectory",Work});if(checkpoint!=null){args.Add("-ResumeCheckpoint");args.Add(checkpoint);}
            child=new ContainedProcess(powershell,args,Path.Combine(Work,"desktop.stdout.txt"),Path.Combine(Work,"desktop.stderr.txt"));
        }
        public void ReadSnapshot(bool strict){
            try{string path=Path.Combine(Work,"job-status.json");if(!File.Exists(path))return;Dictionary<string,object> next=Obj(json.DeserializeObject(Encoding.UTF8.GetString(ReadBounded(path,20000))));
                if((string)Get(next,"format")!="eightmax-native-job-status"||Int(Get(next,"version"),1,1)!=1||(string)Get(next,"build")!=Build||!SameBinding(Get(next,"workbench"),Get(job,"workbench"))||(string)Get(next,"id")!=(string)Get(job,"id")||Int(Get(next,"targetUpdates"),1,MaxUpdates)!=Int(Get(job,"iterations"),1,MaxUpdates))throw new Exception("Managed status binding/target differs.");
                int committed=Int(Get(next,"committedUpdates"),0,Int(Get(job,"iterations"),1,MaxUpdates));string statusStage=Get(next,"stage") as string,message=Get(next,"message") as string,cp=Get(next,"checkpoint") as string;object elapsedValue=Get(next,"elapsedMs");if(!(elapsedValue is int)&&!(elapsedValue is long)&&!(elapsedValue is decimal)&&!(elapsedValue is double))throw new Exception("Invalid native elapsed time.");double elapsed=Convert.ToDouble(elapsedValue,CultureInfo.InvariantCulture);if(Array.IndexOf(new[]{"starting","restoring","training","querying","complete","cancelled","failed"},statusStage)<0||message==null||message.Length>2000||cp==null||cp.Length>2000||Double.IsNaN(elapsed)||Double.IsInfinity(elapsed)||elapsed<0)throw new Exception("Invalid managed status metadata.");if(!String.IsNullOrEmpty(cp))Checkpoint=SafeCheckpoint(data,cp);Snapshot=next;Updates=committed;
            }catch(IOException){if(strict)throw;}catch{if(strict)throw;}
        }
        public void ReadQuality(){
            if(Stage!="complete")return;Dictionary<string,object> value=Obj(json.DeserializeObject(Encoding.UTF8.GetString(ReadBounded(ResultFile,MaxResult))));
            if((string)Get(value,"format")!="eightmax-workbench-native-result"||Int(Get(value,"version"),1,2)!=Int(Get(job,"version"),1,2)||(string)Get(value,"build")!=Build||Canonical(Get(value,"job"),json)!=Canonical(job,json))throw new Exception("Saved result belongs to another native job.");Dictionary<string,object> training=Obj(Get(value,"training"));int target=Int(Get(job,"iterations"),1,MaxUpdates);if(Int(Get(training,"requestedTotalUpdates"),1,MaxUpdates)!=target)throw new Exception("Native result target changed.");Updates=Int(Get(training,"iterations"),0,target);if(!(Get(training,"limitReached") is bool))throw new Exception("Missing memory-limit outcome.");Limit=(bool)Get(training,"limitReached");
        }
        public object QualityView(){return new{completedUpdates=Updates,targetUpdates=Get(job,"iterations"),limitReached=Limit,partial=Stage=="complete"&&Updates<Int(Get(job,"iterations"),1,MaxUpdates),resultAvailable=Stage=="complete"};}
        public void Refresh(){
            if(!Running)return;int before=Updates;string cp=Checkpoint,stage=Stage;
            try{ReadSnapshot(true);if(Snapshot!=null){string next=Get(Snapshot,"stage") as string;if(next=="starting"||next=="restoring"||next=="training"||next=="querying")Stage=next;}}
            catch(IOException){}catch(Exception e){Cancel(e.Message);Stage="failed";Persist();return;}
            int exit;if(child==null)throw new Exception("Native process was not created.");if(child.Exited(out exit)){Running=false;child.Dispose();child=null;Stage=exit==0&&File.Exists(ResultFile)?"complete":exit==2?"cancelled":"failed";Message=Stage=="complete"?"Native result ready.":Stage=="cancelled"?"Native study cancelled; last completed checkpoint retained.":"Native study failed; inspect its managed job logs.";try{ReadQuality();}catch(Exception e){Stage="failed";Message=e.Message;}Persist();}
            else if(before!=Updates||cp!=Checkpoint||stage!=Stage)Persist();
        }
        public void Cancel(string message){if(!Running)return;ReadSnapshot(false);if(child!=null){child.Dispose();child=null;}Running=false;Stage="cancelled";Message=message+" Last completed checkpoint retained.";Persist();}
        public void SkipAttempt(int revision){if(Running)throw new Exception("Cannot skip a running attempt.");Revision=revision;Stage="cancelled";Message="Resume was cancelled before it could start; checkpoint retained.";Persist();}
        public void Fail(string message){if(child!=null){child.Dispose();child=null;}Running=false;Stage="failed";Message=message.Substring(0,Math.Min(1800,message.Length));Persist();}
        public object RecoveryView(){return new{format="eightmax-desktop-current",version=1,job=job,status=View()};}
        public void Persist(bool strict=false){
            if(String.IsNullOrEmpty(Work))return;try{
                SavedAt=DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",CultureInfo.InvariantCulture);string cp=String.IsNullOrEmpty(Checkpoint)?"":Checkpoint.Substring(data.Length).TrimStart(Path.DirectorySeparatorChar,Path.AltDirectorySeparatorChar).Replace('\\','/');string archive=Path.Combine(data,"Archive");
                object record=new{format="eightmax-native-archive",version=1,build=Build,id=Id,job=job,jobHash=BodyHash,status=View(),checkpoint=cp,work=Path.GetFileName(Work),savedAtUtc=SavedAt};
                string recordText=json.Serialize(record);if(Encoding.UTF8.GetByteCount(recordText)>1200000)throw new Exception("Saved study metadata exceeds its limit.");AtomicWrite(Path.Combine(archive,"job-"+Id+".json"),recordText);AtomicWrite(Path.Combine(archive,"job-"+Id+".summary.json"),json.Serialize(new{format="eightmax-native-saved-summary",version=1,build=Build,id=Id,revision=Revision,slot=Get(Obj(Get(job,"workbench")),"slot"),stage=Stage,running=Running,targetUpdates=Get(job,"iterations"),committedUpdates=Updates,resumable=CanResume,resultAvailable=Stage=="complete",limitReached=Limit,partial=Stage=="complete"&&Updates<Int(Get(job,"iterations"),1,MaxUpdates),savedAtUtc=SavedAt}));AtomicWrite(Path.Combine(Work,"desktop-status.json"),json.Serialize(View()));ArchiveOK=true;
            }catch(Exception e){ArchiveOK=false;if(strict)throw;Message=("Archive save failed; keep this job folder. "+e.Message).Substring(0,Math.Min(1900,("Archive save failed; keep this job folder. "+e.Message).Length));}
        }
        public object View(){return new{format="eightmax-desktop-job",version=2,id=Id,revision=Revision,stage=Stage,running=Running,resumable=CanResume,resultAvailable=Stage=="complete",binding=Get(job,"workbench"),targetUpdates=Get(job,"iterations"),nativeStatus=Snapshot,message=Message.Substring(0,Math.Min(2000,Message.Length))};}
    }
    sealed class ContainedProcess : IDisposable {
        IntPtr job=IntPtr.Zero,process=IntPtr.Zero;bool disposed;
        public ContainedProcess(string executable,List<string> args,string stdout,string stderr){
            Native.SECURITY_ATTRIBUTES security=new Native.SECURITY_ATTRIBUTES();security.nLength=Marshal.SizeOf(typeof(Native.SECURITY_ATTRIBUTES));security.bInheritHandle=1;
            IntPtr output=Native.CreateFile(stdout,0x40000000,3,ref security,2,0x80,IntPtr.Zero),error=Native.CreateFile(stderr,0x40000000,3,ref security,2,0x80,IntPtr.Zero),input=Native.CreateFile("NUL",0x80000000,3,ref security,3,0x80,IntPtr.Zero);
            Native.PROCESS_INFORMATION pi=new Native.PROCESS_INFORMATION();
            try{
                if(output==new IntPtr(-1)||error==new IntPtr(-1)||input==new IntPtr(-1))throw new Exception("Cannot open managed process logs.");
                job=Native.CreateJobObject(IntPtr.Zero,null);if(job==IntPtr.Zero)throw new Exception("Cannot create native process lifetime group.");
                Native.JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits=new Native.JOBOBJECT_EXTENDED_LIMIT_INFORMATION();limits.BasicLimitInformation.LimitFlags=0x2000;int size=Marshal.SizeOf(limits);IntPtr block=Marshal.AllocHGlobal(size);try{Marshal.StructureToPtr(limits,block,false);if(!Native.SetInformationJobObject(job,9,block,(uint)size))throw new Exception("Cannot bind native cleanup policy.");}finally{Marshal.FreeHGlobal(block);}
                Native.STARTUPINFO si=new Native.STARTUPINFO();si.cb=Marshal.SizeOf(si);si.dwFlags=0x100;si.hStdInput=input;si.hStdOutput=output;si.hStdError=error;
                StringBuilder command=new StringBuilder(Quote(executable));foreach(string a in args)command.Append(" ").Append(Quote(a));
                if(!Native.CreateProcess(executable,command,IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,null,ref si,out pi))throw new Exception("Cannot start native manager ("+Marshal.GetLastWin32Error()+").");
                process=pi.hProcess;if(!Native.AssignProcessToJobObject(job,process))throw new Exception("Cannot contain the native manager process.");if(Native.ResumeThread(pi.hThread)==0xffffffff)throw new Exception("Cannot resume native manager process.");
            }catch{if(pi.hProcess!=IntPtr.Zero)Native.TerminateProcess(pi.hProcess,1);Dispose();throw;}finally{if(pi.hThread!=IntPtr.Zero)Native.CloseHandle(pi.hThread);foreach(IntPtr h in new[]{output,error,input})if(h!=IntPtr.Zero&&h!=new IntPtr(-1))Native.CloseHandle(h);}
        }
        static string Quote(string s){StringBuilder q=new StringBuilder("\"");int slashes=0;foreach(char c in s){if(c=='\\'){slashes++;continue;}if(c=='\"')q.Append('\\',slashes*2+1).Append(c);else q.Append('\\',slashes).Append(c);slashes=0;}return q.Append('\\',slashes*2).Append('"').ToString();}
        public bool Exited(out int code){uint exit;if(!Native.GetExitCodeProcess(process,out exit))throw new Exception("Cannot read native process state.");code=(int)exit;return exit!=259;}
        public void Dispose(){if(disposed)return;disposed=true;if(job!=IntPtr.Zero){Native.CloseHandle(job);job=IntPtr.Zero;}if(process!=IntPtr.Zero){Native.WaitForSingleObject(process,5000);Native.CloseHandle(process);process=IntPtr.Zero;}}
    }
    static class Native {
        [StructLayout(LayoutKind.Sequential)] public struct SECURITY_ATTRIBUTES { public int nLength;public IntPtr lpSecurityDescriptor;public int bInheritHandle; }
        [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct STARTUPINFO {public int cb;public string lpReserved,lpDesktop,lpTitle;public int dwX,dwY,dwXSize,dwYSize,dwXCountChars,dwYCountChars,dwFillAttribute,dwFlags;public short wShowWindow,cbReserved2;public IntPtr lpReserved2,hStdInput,hStdOutput,hStdError;}
        [StructLayout(LayoutKind.Sequential)] public struct PROCESS_INFORMATION {public IntPtr hProcess,hThread;public int dwProcessId,dwThreadId;}
        [StructLayout(LayoutKind.Sequential)] public struct JOBOBJECT_BASIC_LIMIT_INFORMATION {public long PerProcessUserTimeLimit,PerJobUserTimeLimit;public uint LimitFlags;public UIntPtr MinimumWorkingSetSize,MaximumWorkingSetSize;public uint ActiveProcessLimit;public UIntPtr Affinity;public uint PriorityClass,SchedulingClass;}
        [StructLayout(LayoutKind.Sequential)] public struct IO_COUNTERS {public ulong ReadOperationCount,WriteOperationCount,OtherOperationCount,ReadTransferCount,WriteTransferCount,OtherTransferCount;}
        [StructLayout(LayoutKind.Sequential)] public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;public IO_COUNTERS IoInfo;public UIntPtr ProcessMemoryLimit,JobMemoryLimit,PeakProcessMemoryUsed,PeakJobMemoryUsed;}
        [DllImport("kernel32.dll")]public static extern uint GetCurrentThreadId();
        [DllImport("user32.dll",SetLastError=true)]public static extern bool PostThreadMessage(uint thread,uint message,IntPtr wParam,IntPtr lParam);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]public static extern IntPtr CreateFile(string path,uint access,uint share,ref SECURITY_ATTRIBUTES sa,uint disposition,uint flags,IntPtr template);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]public static extern IntPtr CreateJobObject(IntPtr sa,string name);
        [DllImport("kernel32.dll",SetLastError=true)]public static extern bool SetInformationJobObject(IntPtr job,int kind,IntPtr data,uint size);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]public static extern bool CreateProcess(string app,StringBuilder command,IntPtr processSA,IntPtr threadSA,bool inherit,uint flags,IntPtr environment,string directory,ref STARTUPINFO startup,out PROCESS_INFORMATION info);
        [DllImport("kernel32.dll",SetLastError=true)]public static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
        [DllImport("kernel32.dll")]public static extern uint ResumeThread(IntPtr thread);
        [DllImport("kernel32.dll")]public static extern bool TerminateProcess(IntPtr process,uint code);
        [DllImport("kernel32.dll")]public static extern bool GetExitCodeProcess(IntPtr process,out uint code);
        [DllImport("kernel32.dll")]public static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll")]public static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
    }
    // 0.19: startup/shutdown failures leave a bounded, human-readable record for diagnostics export.
    static void LogFailure(Exception e){try{string dir=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"EightMax-Test-Workbench","Logs");Directory.CreateDirectory(dir);string file=Path.Combine(dir,"desktop-host.log");if(File.Exists(file)&&new FileInfo(file).Length>262144)File.Delete(file);File.AppendAllText(file,DateTime.UtcNow.ToString("o")+" v"+Version+" "+e.GetType().Name+": "+e.Message+"\r\n");}catch{}}
    [STAThread] public static void Main(string[] args){
        bool headless=false;string root=null,ready=null;for(int i=0;i<args.Length;i++){if(args[i]=="--root"&&i+1<args.Length)root=args[++i];else if(args[i]=="--ready"&&i+1<args.Length)ready=args[++i];else if(args[i]=="--headless")headless=true;else{MessageBox.Show("Unsupported desktop argument.");return;}}
        Mutex mutex=new Mutex(false,"Local\\EightMaxWorkbenchDesktopHost");bool owned=false;try{try{owned=mutex.WaitOne(0);}catch(AbandonedMutexException){owned=true;}if(!owned)throw new Exception("The desktop host is already running. Use its Open workbench button.");if(root==null||ready==null)throw new Exception("Use START-DESKTOP.cmd to launch the desktop host.");Application.EnableVisualStyles();new DesktopHost(root,ready).Run(headless);}catch(Exception e){LogFailure(e);if(!headless)MessageBox.Show(e.Message+"\n\nA diagnostic entry was written to %LOCALAPPDATA%\\EightMax-Test-Workbench\\Logs\\desktop-host.log","EightMax desktop host");else Console.Error.WriteLine(e.Message);Environment.ExitCode=1;}finally{if(owned)mutex.ReleaseMutex();mutex.Dispose();}
    }
}
}
