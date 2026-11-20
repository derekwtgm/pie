// EightMax Test Workbench 0.35.0 - the desktop host's INPUT BROKER (compiled into EightMaxWorkbench.exe with DesktopHost.cs).
// The host is the single owner of the physical cursor: it runs ONE EightMaxInput.exe child (stdio pipes, random session token,
// --parent-pid, inside a job object that kills it when the host ends) and forwards whitelisted commands from authenticated
// dashboard/tool requests (/api/input/*). After the driver exits unexpectedly it is NOT restarted silently: commands are refused
// until the operator restarts it, and a restarted driver starts disarmed (automation off).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace EightMax.Workbench {
public sealed class InputBroker {
    static readonly string[] Allowed = { "health", "status", "cancel", "cancel-all", "estop", "reset-estop", "arm", "disarm", "resume", "manual-mode", "release-all", "monitor-start", "monitor-stop",
        "cursor", "monitors", "list-windows", "window-info", "exe-identity", "register-target", "unregister-target", "focus", "move", "move-click", "click", "double-click", "mouse-down", "mouse-up", "key", "type", "clear-field", "read-text", "enter-text", "uia-controls", "wait" };
    sealed class Pending { public readonly ManualResetEvent Done = new ManualResetEvent(false); public string Reply; }
    readonly string exe; readonly JavaScriptSerializer js = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024, RecursionLimit = 32 };
    readonly object gate = new object(); readonly Dictionary<long, Pending> pending = new Dictionary<long, Pending>(); readonly List<string> events = new List<string>();
    Process proc; StreamWriter stdin; IntPtr job = IntPtr.Zero; long seq; long eventSeq; string lastExit; bool crashed; public string Hotkey = "Ctrl+Alt+F12"; public int Starts;
    public InputBroker(string exePath) { exe = exePath; }
    public bool Installed { get { return File.Exists(exe); } }
    public bool Running { get { lock (gate) return proc != null && !proc.HasExited; } }

    [StructLayout(LayoutKind.Sequential)] struct BASIC { public long a, b; public uint LimitFlags; public UIntPtr c, d; public uint e; public UIntPtr f; public uint g, h; }
    [StructLayout(LayoutKind.Sequential)] struct IOC { public ulong a, b, c, d, e, f; }
    [StructLayout(LayoutKind.Sequential)] struct EXT { public BASIC Basic; public IOC Io; public UIntPtr p, q, r, s; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr a, string name);
    [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int cls, ref EXT info, int size);
    [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

    void Event(string kind, string detail) { lock (gate) { events.Add(js.Serialize(new Dictionary<string, object> { { "event", kind }, { "detail", detail }, { "seq", ++eventSeq }, { "at", DateTime.UtcNow.ToString("o") } })); if (events.Count > 200) events.RemoveAt(0); } }
    /// <summary>Start the driver (or keep the running one). Refuses after a crash unless restart is explicit.</summary>
    readonly object startGate = new object();
    public void Ensure(bool explicitStart) {
        lock (startGate) {
            string token; Process p;
            lock (gate) {
                if (proc != null && !proc.HasExited) return;
                if (crashed && !explicitStart) throw new Exception("The input driver stopped unexpectedly (" + lastExit + "). Restart it from Simulator Controls; automation stays off until you enable it again.");
                if (!File.Exists(exe)) throw new Exception("desktop\\bin\\EightMaxInput.exe is missing from this release.");
                byte[] raw = new byte[32]; using (RandomNumberGenerator rng = RandomNumberGenerator.Create()) rng.GetBytes(raw); token = BitConverter.ToString(raw).Replace("-", "").ToLowerInvariant();
                ProcessStartInfo psi = new ProcessStartInfo(exe, "--parent-pid " + Process.GetCurrentProcess().Id + " --hotkey \"" + Hotkey.Replace("\"", "") + "\"") { UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true, StandardOutputEncoding = new UTF8Encoding(false), StandardErrorEncoding = new UTF8Encoding(false) };
                psi.EnvironmentVariables["EIGHTMAX_INPUT_TOKEN"] = token;
                p = Process.Start(psi); proc = p; Starts++; crashed = false; lastExit = null;
                try { if (job == IntPtr.Zero) { job = CreateJobObject(IntPtr.Zero, null); EXT info = new EXT(); info.Basic.LimitFlags = 0x2000 /*KILL_ON_JOB_CLOSE*/; SetInformationJobObject(job, 9, ref info, Marshal.SizeOf(typeof(EXT))); } AssignProcessToJobObject(job, p.Handle); } catch (Exception) { }
                stdin = new StreamWriter(p.StandardInput.BaseStream, new UTF8Encoding(false)) { AutoFlush = true };
            }
            Thread t = new Thread(delegate() { Read(p); }) { IsBackground = true, Name = "input-broker-reader" }; t.Start();
            Thread e = new Thread(delegate() { try { string l; while ((l = p.StandardError.ReadLine()) != null) Event("driver-stderr", l.Length > 300 ? l.Substring(0, 300) : l); } catch (Exception) { } }) { IsBackground = true }; e.Start();
            string hello = Send(new Dictionary<string, object> { { "cmd", "hello" }, { "token", token } }, 10000, true);
            if (hello.IndexOf("\"ok\":true", StringComparison.Ordinal) < 0) { try { p.Kill(); } catch (Exception) { } throw new Exception("The input driver did not accept the session: " + hello); }
            Event("driver-started", "pid " + p.Id + ", hotkey " + Hotkey);
        }
    }
    void Read(Process p) {
        try { string line; while ((line = p.StandardOutput.ReadLine()) != null) {
            Dictionary<string, object> m; try { m = js.DeserializeObject(line) as Dictionary<string, object>; } catch (Exception) { continue; } if (m == null) continue;
            if (m.ContainsKey("event")) { lock (gate) { m["seq"] = ++eventSeq; events.Add(js.Serialize(m)); if (events.Count > 200) events.RemoveAt(0); } continue; }
            object idv; if (!m.TryGetValue("id", out idv)) continue; long id = Convert.ToInt64(idv); Pending w; lock (gate) { if (pending.TryGetValue(id, out w)) pending.Remove(id); } if (w != null) { w.Reply = line; w.Done.Set(); } } }
        catch (Exception) { }
        lock (gate) {
            int code = -1; try { p.WaitForExit(2000); code = p.ExitCode; } catch (Exception) { }
            if (proc == p) { lastExit = "exit code " + code; crashed = !stopping; proc = null; }
            foreach (Pending w in pending.Values) { w.Reply = "{\"ok\":false,\"code\":\"driver-exited\",\"error\":\"The input driver exited (" + lastExit + ").\"}"; w.Done.Set(); } pending.Clear();
        }
        Event(stopping ? "driver-stopped" : "driver-exited", lastExit);
    }
    bool stopping;
    string Send(Dictionary<string, object> m, int timeoutMs, bool locked) {
        Pending w = new Pending(); long id; lock (gate) { id = ++seq; pending[id] = w; m["id"] = id; if (stdin == null) throw new Exception("Input driver not started."); stdin.WriteLine(js.Serialize(m)); }
        if (!w.Done.WaitOne(timeoutMs)) { lock (gate) pending.Remove(id); return "{\"ok\":false,\"code\":\"timeout\",\"error\":\"No reply from the input driver within " + timeoutMs + " ms.\"}"; }
        return w.Reply;
    }
    /// <summary>Forward one JSON command object {cmd, ...}. Returns the driver's reply line (JSON).</summary>
    public string Command(string body) {
        Dictionary<string, object> m = js.DeserializeObject(body) as Dictionary<string, object>; if (m == null) throw new Exception("Send a JSON object {\"cmd\": ...}.");
        string cmd = m.ContainsKey("cmd") ? m["cmd"] as string : null; if (cmd == null || Array.IndexOf(Allowed, cmd) < 0) throw new Exception("Unknown or forbidden input command.");
        int timeout = 30000; if (m.ContainsKey("timeoutMs")) { timeout = Math.Max(1000, Math.Min(120000, Convert.ToInt32(m["timeoutMs"]))); m.Remove("timeoutMs"); }
        if (m.ContainsKey("id")) m.Remove("id");
        Ensure(false); return Send(m, timeout, false);
    }
    public string EmergencyStop(string reason) { if (!Running) { Event("estop-without-driver", reason); return "{\"ok\":true,\"running\":false}"; } return Send(new Dictionary<string, object> { { "cmd", "estop" }, { "reason", reason } }, 5000, false); }
    public string Status() {
        string driver = Running ? Send(new Dictionary<string, object> { { "cmd", "status" } }, 3000, false) : "null"; string[] ev; lock (gate) ev = events.ToArray();
        return "{\"format\":\"eightmax-input-status\",\"version\":1,\"installed\":" + (Installed ? "true" : "false") + ",\"running\":" + (Running ? "true" : "false") + ",\"crashed\":" + (crashed ? "true" : "false") + ",\"lastExit\":" + js.Serialize(lastExit) + ",\"starts\":" + Starts + ",\"hotkey\":" + js.Serialize(Hotkey) + ",\"driver\":" + driver + ",\"events\":[" + string.Join(",", ev) + "]}";
    }
    public void Stop() {
        Process p; lock (gate) { p = proc; stopping = true; }
        if (p != null) { try { Send(new Dictionary<string, object> { { "cmd", "release-all" } }, 1500, false); Send(new Dictionary<string, object> { { "cmd", "shutdown" } }, 1500, false); } catch (Exception) { } try { if (!p.WaitForExit(2000)) p.Kill(); } catch (Exception) { } }
        lock (gate) { proc = null; stdin = null; stopping = false; crashed = false; }
    }
    public void Restart() { Stop(); Ensure(true); }
    public void Dispose() { Stop(); if (job != IntPtr.Zero) { CloseHandle(job); job = IntPtr.Zero; } }
}
}
