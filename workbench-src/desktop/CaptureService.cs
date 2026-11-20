// EightMax Test Workbench 0.35.0 - Windows screen-capture service (C# 5 compatible; compiled together with DesktopHost.cs).
//
// What it does: lists top-level windows and monitors, and captures ONE operator-selected window client area or ONE
// operator-selected desktop region as a PNG, using documented Win32 / GDI / DWM calls only:
//   PrintWindow(PW_CLIENTONLY | PW_RENDERFULLCONTENT)  - asks the window to paint itself, so covered windows still capture
//   BitBlt(SRCCOPY | CAPTUREBLT) from the screen DC     - copies what is visible; occlusion is measured and reported
//   DwmGetWindowAttribute(DWMWA_CLOAKED)                - cloaked / other-virtual-desktop windows are reported, not captured
// Windows Graphics Capture (0.27): this .NET Framework / C# 5 host cannot project WinRT, so WGC runs in a separate self-contained
// .NET 8 helper (desktop\bin\EightMaxWgc.exe, source in desktop/wgc). The host only starts it for an operator-selected window, with
// a time limit, and passes its JSON result and PNG through. It is used ONLY when method == "windows-graphics-capture" is requested
// explicitly: a failure is reported as a failure and never silently replaced by PrintWindow or BitBlt.
// 0.29 (merge of 0.27 + 0.28): the helper is looked up next to the release root set by the host (HelperRoot) first, because a
// host compiled on first launch runs from %LOCALAPPDATA%\...\DesktopCache, not from desktop\bin.
//
// What it will never do: read or write another process's memory, inject code, install hooks, synthesise input, or hide
// itself. Frames are never reused: every call captures fresh pixels or reports why it could not.
// STATUS: compiled on Linux with Mono; the self-test control flow ran on Mono/X11 with a test double. NOT executed on Windows.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace EightMax.Workbench {
public static class CaptureService {
    // ---- Win32 ----
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct MONITORINFOEX { public int cbSize; public RECT rcMonitor, rcWork; public int dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice; }
    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdc, ref RECT rect, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int index);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc cb, IntPtr data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFOEX info);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
    [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr hMonitor, int type, out uint x, out uint y);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr hdc);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int w, int h);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, uint rop);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr hdc);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int value, int size);

    const uint SRCCOPY = 0x00CC0020, CAPTUREBLT = 0x40000000, PW_CLIENTONLY = 1, PW_RENDERFULLCONTENT = 2, GW_HWNDPREV = 3, MONITOR_DEFAULTTONEAREST = 2;
    const int GWL_EXSTYLE = -20, WS_EX_TOOLWINDOW = 0x80, DWMWA_CLOAKED = 13;
    const int MaxPixels = 16 * 1024 * 1024;

    static readonly object gate = new object();
    static readonly Stopwatch clock = Stopwatch.StartNew();
    static long frameCounter;
    static bool dpiSet;
    static readonly List<string> audit = new List<string>();

    /// <summary>Per-monitor DPI awareness makes every size below physical pixels (what the screen really shows).
    /// 0.28.0: SetThreadDpiAwarenessContext applies to the CALLING THREAD only. The host serves requests on several
    /// threads, so this is applied on every thread that captures (tracked per thread), not once per process.</summary>
    [ThreadStatic] static string threadDpiMode;
    public static string EnsureDpiAware() {
        if (threadDpiMode != null) return threadDpiMode;
        string mode = null;
        try { IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4)); mode = previous != IntPtr.Zero ? "per-monitor-v2 (thread)" : null; } catch (Exception) { }
        if (mode == null) { lock (gate) { try { if (!dpiSet) SetProcessDPIAware(); dpiSet = true; mode = "system-aware (process)"; } catch (Exception e) { mode = "unavailable: " + e.Message; } } }
        threadDpiMode = mode; return mode;
    }

    // ---- JSON helpers (no dependency on the host's serializer: frames are larger than its limit) ----
    static string Q(string s) {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder("\"");
        foreach (char c in s) { if (c == '"' || c == '\\') { b.Append('\\').Append(c); } else if (c < 32) { b.AppendFormat("\\u{0:x4}", (int)c); } else b.Append(c); }
        return b.Append('"').ToString();
    }
    static string N(double v) { return v.ToString("0.######", System.Globalization.CultureInfo.InvariantCulture); }
    static string B(bool v) { return v ? "true" : "false"; }
    static string Hex(IntPtr h) { return "0x" + h.ToInt64().ToString("x"); }
    static IntPtr ParseHandle(string s) {
        if (s == null) throw new ArgumentException("Window handle missing.");
        s = s.Trim(); long v;
        if (s.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) v = Convert.ToInt64(s.Substring(2), 16); else v = Convert.ToInt64(s);
        return new IntPtr(v);
    }
    static string Title(IntPtr h) { StringBuilder sb = new StringBuilder(512); GetWindowText(h, sb, sb.Capacity); return sb.ToString(); }
    static string ClassName(IntPtr h) { StringBuilder sb = new StringBuilder(256); GetClassName(h, sb, sb.Capacity); return sb.ToString(); }
    static bool Cloaked(IntPtr h) { try { int v; return DwmGetWindowAttribute(h, DWMWA_CLOAKED, out v, 4) == 0 && v != 0; } catch (Exception) { return false; } }
    static double DpiScale(IntPtr h) {
        try { uint d = GetDpiForWindow(h); if (d >= 48) return d / 96.0; } catch (Exception) { }
        try { uint x, y; IntPtr m = MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST); if (GetDpiForMonitor(m, 0, out x, out y) == 0 && x >= 48) return x / 96.0; } catch (Exception) { }
        return 1.0;
    }

    // ---- enumeration ----
    public static string ListWindowsJson(int ownPid) {
        List<string> rows = new List<string>();
        EnumWindows(delegate(IntPtr h, IntPtr l) {
            if (!IsWindowVisible(h)) return true;
            string title = Title(h); if (title.Length == 0) return true;
            if ((GetWindowLong(h, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) != 0) return true;
            uint pid; GetWindowThreadProcessId(h, out pid); if (ownPid != 0 && pid == (uint)ownPid) return true;
            RECT w, c; GetWindowRect(h, out w); GetClientRect(h, out c);
            bool min = IsIconic(h), cl = Cloaked(h);
            rows.Add("{\"hwnd\":" + Q(Hex(h)) + ",\"pid\":" + pid + ",\"title\":" + Q(title.Length > 200 ? title.Substring(0, 200) : title) + ",\"className\":" + Q(ClassName(h)) +
                ",\"x\":" + w.Left + ",\"y\":" + w.Top + ",\"width\":" + (w.Right - w.Left) + ",\"height\":" + (w.Bottom - w.Top) + ",\"clientWidth\":" + (c.Right - c.Left) + ",\"clientHeight\":" + (c.Bottom - c.Top) +
                ",\"minimized\":" + B(min) + ",\"cloaked\":" + B(cl) + ",\"dpiScale\":" + N(DpiScale(h)) + "}");
            return rows.Count < 200;
        }, IntPtr.Zero);
        return "{\"format\":\"eightmax-capture-windows\",\"version\":1,\"windows\":[" + string.Join(",", rows.ToArray()) + "]}";
    }
    public static string ListMonitorsJson() {
        List<string> rows = new List<string>(); int index = 0;
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(IntPtr m, IntPtr dc, ref RECT r, IntPtr d) {
            MONITORINFOEX info = new MONITORINFOEX(); info.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX));
            if (GetMonitorInfo(m, ref info)) {
                uint dx = 96, dy = 96; try { GetDpiForMonitor(m, 0, out dx, out dy); } catch (Exception) { }
                rows.Add("{\"id\":" + index + ",\"name\":" + Q(info.szDevice) + ",\"x\":" + info.rcMonitor.Left + ",\"y\":" + info.rcMonitor.Top + ",\"width\":" + (info.rcMonitor.Right - info.rcMonitor.Left) + ",\"height\":" + (info.rcMonitor.Bottom - info.rcMonitor.Top) + ",\"dpiScale\":" + N(dx / 96.0) + ",\"primary\":" + B((info.dwFlags & 1) != 0) + "}");
                index++;
            }
            return true;
        }, IntPtr.Zero);
        return "{\"format\":\"eightmax-capture-monitors\",\"version\":1,\"virtual\":{\"x\":" + GetSystemMetrics(76) + ",\"y\":" + GetSystemMetrics(77) + ",\"width\":" + GetSystemMetrics(78) + ",\"height\":" + GetSystemMetrics(79) + "},\"monitors\":[" + string.Join(",", rows.ToArray()) + "]}";
    }

    // ---- target validation: identity must match what the operator selected ----
    public const string WgcMethod = "windows-graphics-capture";
    /// <summary>0.29: the release's desktop\\bin folder, set by the host at start-up (null in the stand-alone capture tool).</summary>
    public static string HelperRoot;
    /// <summary>Path of the WGC helper next to the host executable (or null when it is not installed).</summary>
    public static string WgcHelperPath() {
        try { if (HelperRoot != null) { string q = Path.Combine(HelperRoot, "EightMaxWgc.exe"); if (File.Exists(q)) return q; }
              foreach (string dir in new string[] { AppDomain.CurrentDomain.BaseDirectory, Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "bin"), Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "desktop", "bin") }) { string p = Path.GetFullPath(Path.Combine(dir, "EightMaxWgc.exe")); if (File.Exists(p)) return p; } } catch (Exception) { }
        return null;
    }
    public static bool WgcInstalled() { return WgcHelperPath() != null; }
    static string FieldOf(string json, string name) {   // tiny flat-JSON string/number reader for the helper's single-line reply
        int i = json.IndexOf("\"" + name + "\":", StringComparison.Ordinal); if (i < 0) return null; i += name.Length + 3;
        if (i < json.Length && json[i] == '"') { StringBuilder b = new StringBuilder(); for (i++; i < json.Length && json[i] != '"'; i++) { if (json[i] == '\\' && i + 1 < json.Length) i++; b.Append(json[i]); } return b.ToString(); }
        int j = i; while (j < json.Length && json[j] != ',' && json[j] != '}') j++; return json.Substring(i, j - i);
    }
    // ---- 0.29: persistent Windows Graphics Capture sessions ----------------------------------------------------------------------
    // 0.27 started EightMaxWgc.exe (and therefore a new capture session, D3D device and frame pool) for EVERY frame. Now the host keeps
    // ONE helper process per selected window ("--session --emit-png"), reads its JSON event lines on a background thread and serves
    // the newest frame. WGC only produces a frame when the window content changes, so an unchanged window is served again as a
    // duplicate (same frameId; contentAgeMs grows) instead of being captured again. A session ends on capture close, target change,
    // target loss, helper exit or host shutdown (CloseAllStreams). At most MaxStreams sessions run at once.
    public sealed class WgcStream : IDisposable {
        public readonly string Key; Process proc; readonly object sync = new object(); System.Threading.Thread reader;
        long seq, delivered; string png; int width, height; double sysMs, arrivedMs, startedMs; public double FirstFrameMs = -1;
        public volatile bool Ended; public string EndCode, EndReason, LastEvent; public long Resizes, Stalls, Events, Frames; public bool Minimized;
        public WgcStream(string key) { Key = key; }
        public double StartedMs { get { return startedMs; } }
        /// <summary>Starts the helper. args are fixed here; only a validated hex handle and integer pid/fps reach the command line.</summary>
        public void Start(string helper, string hwnd, int pid, double fps, string tempDir) {
            startedMs = clock.Elapsed.TotalMilliseconds;
            ProcessStartInfo psi = new ProcessStartInfo(helper, "--session --emit-png --hwnd " + hwnd + " --pid " + pid.ToString(System.Globalization.CultureInfo.InvariantCulture) + " --fps " + fps.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture) + " --queue 2 --stall-ms 3000 --timeout-ms 5000 --out-dir \"" + tempDir + "\"");
            psi.UseShellExecute = false; psi.CreateNoWindow = true; psi.RedirectStandardOutput = true; psi.RedirectStandardError = true; psi.RedirectStandardInput = true;
            proc = Process.Start(psi); proc.ErrorDataReceived += delegate { }; proc.BeginErrorReadLine();
            reader = new System.Threading.Thread(ReadLoop); reader.IsBackground = true; reader.Start();
        }
        void ReadLoop() {
            try {
                string line;
                while ((line = proc.StandardOutput.ReadLine()) != null) {
                    line = line.Trim(); if (line.Length == 0 || line[0] != '{') continue;
                    string ev = FieldOf(line, "event"), ok = FieldOf(line, "ok");
                    lock (sync) {
                        Events++; LastEvent = ev ?? (ok == "false" ? "refused" : "other");
                        if (ev == "frame") { string b64 = FieldOf(line, "png"); if (b64 == null) continue; png = b64; width = ParseInt(FieldOf(line, "width")); height = ParseInt(FieldOf(line, "height")); sysMs = ParseD(FieldOf(line, "systemRelativeTimeMs")); arrivedMs = clock.Elapsed.TotalMilliseconds; seq++; Frames++; if (FirstFrameMs < 0) FirstFrameMs = arrivedMs - startedMs; System.Threading.Monitor.PulseAll(sync); }
                        else if (ev == "resized") Resizes++;
                        else if (ev == "stalled") Stalls++;
                        else if (ev == "minimized") Minimized = true;
                        else if (ev == "restored") Minimized = false;
                        else if (ev == "target-lost" || ev == "target-closed") { Ended = true; EndCode = "target-lost"; EndReason = "The window closed during the capture session."; System.Threading.Monitor.PulseAll(sync); }
                        else if (ev == "capture-timeout") { Ended = true; EndCode = "no-frame"; EndReason = "Windows Graphics Capture produced no frame within 5 s."; System.Threading.Monitor.PulseAll(sync); }
                        else if (ok == "false") { Ended = true; EndCode = FieldOf(line, "code") ?? "capture-failed"; EndReason = FieldOf(line, "reason") ?? "Windows Graphics Capture refused the target."; System.Threading.Monitor.PulseAll(sync); }
                    }
                }
            } catch (Exception e) { lock (sync) { EndReason = e.GetType().Name + ": " + e.Message; } }
            lock (sync) { if (!Ended) { Ended = true; EndCode = EndCode ?? "capture-interrupted"; EndReason = EndReason ?? "The capture helper stopped."; } System.Threading.Monitor.PulseAll(sync); }
        }
        static int ParseInt(string v) { int x; return int.TryParse(v, out x) ? x : 0; }
        static double ParseD(string v) { double x; return double.TryParse(v, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out x) ? x : 0; }
        /// <summary>Newest frame as host JSON pieces; waits up to waitMs for a NEW frame. Returns false when the session has ended or has no frame yet.</summary>
        public bool Take(int waitMs, out string b64, out int w, out int h, out long id, out bool fresh, out double contentAgeMs, out double sourceMs) {
            lock (sync) {
                DateTime until = DateTime.UtcNow.AddMilliseconds(waitMs);
                while (seq <= delivered && !Ended) { int left = (int)(until - DateTime.UtcNow).TotalMilliseconds; if (left <= 0) break; System.Threading.Monitor.Wait(sync, left); }
                b64 = png; w = width; h = height; id = seq; fresh = seq > delivered; contentAgeMs = clock.Elapsed.TotalMilliseconds - arrivedMs; sourceMs = sysMs;
                if (Ended) return false;
                if (png == null) return false;
                delivered = seq; return true;
            }
        }
        public bool Alive { get { try { return proc != null && !proc.HasExited && !Ended; } catch (Exception) { return false; } } }
        public void Dispose() {
            try { if (proc != null && !proc.HasExited) { try { proc.StandardInput.WriteLine("stop"); proc.StandardInput.Flush(); } catch (Exception) { } if (!proc.WaitForExit(2000)) { try { proc.Kill(); } catch (Exception) { } proc.WaitForExit(2000); } } } catch (Exception) { }
            try { if (proc != null) proc.Dispose(); } catch (Exception) { }
            lock (sync) { Ended = true; if (EndCode == null) EndCode = "closed"; png = null; System.Threading.Monitor.PulseAll(sync); }
        }
    }
    const int MaxStreams = 10;
    static readonly Dictionary<string, WgcStream> streams = new Dictionary<string, WgcStream>();
    static readonly List<string> streamOrder = new List<string>();
    /// <summary>Ends every persistent capture session (host shutdown, capture close). Returns how many were running.</summary>
    public static int CloseAllStreams() { List<WgcStream> all; lock (gate) { all = new List<WgcStream>(streams.Values); streams.Clear(); streamOrder.Clear(); } foreach (WgcStream x in all) x.Dispose(); return all.Count; }
    public static int CloseStream(Target t) { if (t == null || t.Hwnd == null) return CloseAllStreams(); WgcStream x = null; string key = StreamKey(t); lock (gate) { if (streams.TryGetValue(key, out x)) { streams.Remove(key); streamOrder.Remove(key); } } if (x != null) { x.Dispose(); return 1; } return 0; }
    public static int StreamCount { get { lock (gate) return streams.Count; } }
    static string StreamKey(Target t) { return (t.Hwnd ?? "").ToLowerInvariant() + "|" + t.Pid; }
    /// <summary>Test seam (Linux harness): run the stream machinery with a fake helper, no window checks.</summary>
    public static string StreamFrameForTest(string helper, string hwnd, int pid, int waitMs) { return StreamFrame(helper, new Target { Kind = "window", Hwnd = hwnd, Pid = pid, Method = WgcMethod }, hwnd, (uint)pid, 0, waitMs); }
    static string StreamFrame(string helper, Target t, string hexHandle, uint pid, double t0, int waitMs) {
        string key = StreamKey(t); WgcStream st = null, old = null;
        lock (gate) {
            if (streams.TryGetValue(key, out st) && !st.Alive) { streams.Remove(key); streamOrder.Remove(key); old = st; st = null; }
            if (st == null) {
                if (streams.Count >= MaxStreams && streamOrder.Count > 0) { string drop = streamOrder[0]; WgcStream d; if (streams.TryGetValue(drop, out d)) { streams.Remove(drop); if (old == null) old = d; else d.Dispose(); } streamOrder.RemoveAt(0); }
                st = new WgcStream(key); string dir = Path.Combine(Path.GetTempPath(), "eightmax-wgc-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(dir);
                st.Start(helper, hexHandle, (int)pid, 10, dir); streams[key] = st; streamOrder.Add(key);
            }
        }
        if (old != null) { string endCode = old.EndCode, endReason = old.EndReason; old.Dispose(); if (endCode == "target-lost") { CloseStream(t); return Reject("target-lost", endReason ?? "The window closed.", false); } }
        string b64; int w, h; long id; bool fresh; double contentAge, src;
        if (!st.Take(st.Frames == 0 ? Math.Max(waitMs, 5000) : waitMs, out b64, out w, out h, out id, out fresh, out contentAge, out src)) {
            string code = st.EndCode ?? (st.Frames == 0 ? "no-frame" : "capture-interrupted"), reason = st.EndReason ?? "No frame from the Windows Graphics Capture session.";
            if (st.Ended) CloseStream(t);
            return Reject(code, reason, st.Minimized || code == "target-minimized");
        }
        double t1 = clock.Elapsed.TotalMilliseconds;
        return "{\"ok\":true,\"method\":\"windows-graphics-capture\",\"width\":" + w + ",\"height\":" + h + ",\"frameId\":" + id + ",\"hostTimeMs\":" + N(t1) + ",\"ageMs\":" + N(t1 - t0) + ",\"contentAgeMs\":" + N(contentAge) + ",\"sourceSystemTimeMs\":" + N(src) +
            ",\"session\":{\"persistent\":true,\"fresh\":" + B(fresh) + ",\"framesFromSession\":" + st.Frames + ",\"firstFrameMs\":" + N(st.FirstFrameMs) + ",\"resizes\":" + st.Resizes + ",\"stalls\":" + st.Stalls + "}" +
            ",\"minimized\":false,\"cloaked\":false,\"target\":{\"kind\":\"window\",\"hwnd\":" + Q(hexHandle) + ",\"pid\":" + pid + "},\"png\":" + Q(b64) + "}";
    }
    /// <summary>One Windows Graphics Capture frame of an operator-selected, identity-checked window from its persistent session.
    /// Never falls back to another method. (0.27 design: identity checked before the helper runs; 0.29: the session persists.)</summary>
    static string GrabWgc(Target t, double t0) {
        if (t.Kind != "window") return Reject("backend-unsupported-target", "Windows Graphics Capture is offered here for windows only; use a region (screen-copy) for desktop regions.", false);
        string helper = WgcHelperPath(); if (helper == null) return Reject("backend-unavailable", "EightMaxWgc.exe is not installed next to the host, so Windows Graphics Capture is unavailable. Pick another capture method explicitly.", false);
        IntPtr h; bool min; string bad = CheckWindow(t, out h, out min); if (bad != null) { if (Field(bad, "code") == "target-lost") CloseStream(t); return bad; }
        uint pid; GetWindowThreadProcessId(h, out pid);
        try {
            string reply = StreamFrame(helper, t, Hex(h), pid, t0, 1000);
            if (reply.StartsWith("{\"ok\":true", StringComparison.Ordinal)) { RECT c; GetClientRect(h, out c); POINT origin = new POINT(); ClientToScreen(h, ref origin);
                reply = reply.Substring(0, reply.Length - 1) + ",\"dpiScale\":" + N(DpiScale(h)) + ",\"bounds\":{\"x\":" + origin.X + ",\"y\":" + origin.Y + ",\"width\":" + (c.Right - c.Left) + ",\"height\":" + (c.Bottom - c.Top) + "},\"title\":" + Q(Title(h)) + "}"; }
            return reply;
        } catch (Exception e) { CloseStream(t); return Reject("capture-failed", e.GetType().Name + ": " + e.Message, false); }
    }
    static string Field(string json, string name) { return FieldOf(json, name); }

    public sealed class Target { public string Kind, Hwnd, Title, Method = "auto"; public int Pid, X, Y, Width, Height; }
    static string Reject(string code, string reason, bool minimized) { return "{\"ok\":false,\"code\":" + Q(code) + ",\"reason\":" + Q(reason) + ",\"minimized\":" + B(minimized) + "}"; }

    static string CheckWindow(Target t, out IntPtr h, out bool minimized) {
        h = IntPtr.Zero; minimized = false;
        try { h = ParseHandle(t.Hwnd); } catch (Exception e) { return Reject("capture-failed", "Bad window handle: " + e.Message, false); }
        if (!IsWindow(h)) return Reject("target-lost", "The window no longer exists.", false);
        uint pid; GetWindowThreadProcessId(h, out pid);
        if (t.Pid != 0 && pid != (uint)t.Pid) return Reject("target-identity-changed", "The handle now belongs to process " + pid + ", not " + t.Pid + " (handle reuse).", false);
        if (t.Title != null && t.Title.Length > 0 && Title(h) != t.Title && !Title(h).StartsWith(t.Title, StringComparison.Ordinal)) return Reject("target-identity-changed", "The window title changed from the one the operator selected.", false);
        minimized = IsIconic(h);
        if (minimized) return Reject("target-minimized", "The window is minimised; Windows provides no pixels for it.", true);
        if (!IsWindowVisible(h)) return Reject("target-lost", "The window is not visible.", false);
        if (Cloaked(h)) return Reject("target-occluded", "The window is cloaked (hidden or on another virtual desktop).", false);
        return null;
    }

    /// <summary>Fraction (0..1) of the client rectangle covered by windows above it in z-order, measured on a 48x48 grid.</summary>
    static double OccludedFraction(IntPtr h, RECT client) {
        int w = client.Right - client.Left, ht = client.Bottom - client.Top; if (w <= 0 || ht <= 0) return 1.0;
        const int G = 48; bool[,] hit = new bool[G, G]; int covered = 0;
        IntPtr above = GetWindow(h, GW_HWNDPREV); int guard = 0;
        while (above != IntPtr.Zero && guard++ < 400) {
            if (IsWindowVisible(above) && !IsIconic(above) && (GetWindowLong(above, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) == 0 && !Cloaked(above)) {
                RECT r; if (GetWindowRect(above, out r)) {
                    for (int gy = 0; gy < G; gy++) for (int gx = 0; gx < G; gx++) {
                        if (hit[gx, gy]) continue;
                        int px = client.Left + (int)((gx + 0.5) * w / G), py = client.Top + (int)((gy + 0.5) * ht / G);
                        if (px >= r.Left && px < r.Right && py >= r.Top && py < r.Bottom) { hit[gx, gy] = true; covered++; }
                    }
                }
            }
            above = GetWindow(above, GW_HWNDPREV);
        }
        return covered / (double)(G * G);
    }

    static string Encode(Bitmap bmp, out int w, out int h) {
        w = bmp.Width; h = bmp.Height;
        using (MemoryStream ms = new MemoryStream()) { bmp.Save(ms, ImageFormat.Png); return Convert.ToBase64String(ms.ToArray()); }
    }
    static bool AllFlat(Bitmap bmp) {
        int step = Math.Max(1, Math.Min(bmp.Width, bmp.Height) / 24); int first = 0; bool have = false;
        for (int y = 0; y < bmp.Height; y += step) for (int x = 0; x < bmp.Width; x += step) { int c = bmp.GetPixel(x, y).ToArgb(); if (!have) { first = c; have = true; } else if (c != first) return false; }
        return true;
    }

    /// <summary>Validate and describe a target without capturing (the host's /api/capture/open).</summary>
    public static string OpenJson(Target t, string consentNote) {
        if (t == null) return Reject("capture-failed", "No target.", false);
        lock (gate) { audit.Add(DateTime.UtcNow.ToString("o") + " open " + t.Kind + " " + t.Hwnd + " pid=" + t.Pid + " title=" + t.Title + " note=" + consentNote); if (audit.Count > 500) audit.RemoveAt(0); }
        if (t.Kind == "window") {
            IntPtr h; bool min; string bad = CheckWindow(t, out h, out min);
            if (bad != null) return bad;
            uint pid; GetWindowThreadProcessId(h, out pid);
            if (t.Method == WgcMethod && !WgcInstalled()) return Reject("backend-unavailable", "EightMaxWgc.exe is not installed, so Windows Graphics Capture cannot be used.", false);
            return "{\"ok\":true,\"method\":" + Q(t.Method == WgcMethod ? WgcMethod : t.Method == "screen-copy" ? "screen-copy" : "print-window") + ",\"target\":{\"kind\":\"window\",\"hwnd\":" + Q(Hex(h)) + ",\"pid\":" + pid + ",\"title\":" + Q(Title(h)) + "}}";
        }
        if (t.Kind == "region") {
            if (t.Width < 16 || t.Height < 16 || t.Width * t.Height > MaxPixels) return Reject("capture-failed", "Region must be at least 16x16 and at most 16 megapixels.", false);
            int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
            if (t.X < vx || t.Y < vy || t.X + t.Width > vx + vw || t.Y + t.Height > vy + vh) return Reject("region-offscreen", "The region extends beyond the virtual desktop.", false);
            return "{\"ok\":true,\"method\":\"screen-copy\",\"target\":{\"kind\":\"region\",\"x\":" + t.X + ",\"y\":" + t.Y + ",\"width\":" + t.Width + ",\"height\":" + t.Height + "}}";
        }
        return Reject("capture-failed", "Unknown target kind.", false);
    }

    /// <summary>Capture one fresh frame. Never returns cached pixels.</summary>
    public static string GrabJson(Target t) {
        double t0 = clock.Elapsed.TotalMilliseconds;
        if (t == null) return Reject("capture-failed", "No target.", false);
        if (t.Method == WgcMethod) return GrabWgc(t, t0);
        IntPtr screen = IntPtr.Zero, mem = IntPtr.Zero, bitmap = IntPtr.Zero, old = IntPtr.Zero;
        try {
            if (t.Kind == "window") {
                IntPtr h; bool min; string bad = CheckWindow(t, out h, out min); if (bad != null) return bad;
                RECT c; GetClientRect(h, out c); int w = c.Right - c.Left, ht = c.Bottom - c.Top;
                if (w < 16 || ht < 16 || w * ht > MaxPixels) return Reject("invalid-frame", "Client area " + w + "x" + ht + " is outside the supported size.", false);
                POINT origin = new POINT(); ClientToScreen(h, ref origin);
                RECT clientScreen = new RECT(); clientScreen.Left = origin.X; clientScreen.Top = origin.Y; clientScreen.Right = origin.X + w; clientScreen.Bottom = origin.Y + ht;
                double occ = OccludedFraction(h, clientScreen);
                screen = GetDC(IntPtr.Zero); mem = CreateCompatibleDC(screen); bitmap = CreateCompatibleBitmap(screen, w, ht); old = SelectObject(mem, bitmap);
                string method = "print-window";
                bool done = t.Method != "screen-copy" && PrintWindow(h, mem, PW_CLIENTONLY | PW_RENDERFULLCONTENT);
                if (!done) {
                    if (occ > 0.0) return Reject("target-occluded", "PrintWindow failed and " + (int)Math.Round(occ * 100) + "% of the window is covered, so a screen copy would show other windows.", false);
                    method = "screen-copy";
                    if (!BitBlt(mem, 0, 0, w, ht, screen, origin.X, origin.Y, SRCCOPY | CAPTUREBLT)) return Reject("capture-failed", "BitBlt failed (error " + Marshal.GetLastWin32Error() + ").", false);
                } else if (t.Method == "screen-copy") method = "print-window";
                using (Bitmap bmp = Image.FromHbitmap(bitmap)) {
                    if (AllFlat(bmp)) return Reject("invalid-frame", "The captured image is a single flat colour (the application may render with a surface that PrintWindow cannot read).", false);
                    int fw, fh; string png = Encode(bmp, out fw, out fh);
                    long id = System.Threading.Interlocked.Increment(ref frameCounter); uint pid; GetWindowThreadProcessId(h, out pid);
                    double t1 = clock.Elapsed.TotalMilliseconds;
                    return "{\"ok\":true,\"method\":" + Q(method) + ",\"width\":" + fw + ",\"height\":" + fh + ",\"dpiScale\":" + N(DpiScale(h)) + ",\"frameId\":" + id + ",\"hostTimeMs\":" + N(t1) + ",\"ageMs\":" + N(t1 - t0) + ",\"minimized\":false,\"cloaked\":false,\"occludedFraction\":" + N(method == "print-window" ? 0.0 : occ) + ",\"coveredFraction\":" + N(occ) +
                        ",\"bounds\":{\"x\":" + origin.X + ",\"y\":" + origin.Y + ",\"width\":" + w + ",\"height\":" + ht + "},\"target\":{\"kind\":\"window\",\"hwnd\":" + Q(Hex(h)) + ",\"pid\":" + pid + ",\"title\":" + Q(Title(h)) + "},\"png\":" + Q(png) + "}";
                }
            }
            if (t.Kind == "region") {
                if (t.Width < 16 || t.Height < 16 || t.Width * t.Height > MaxPixels) return Reject("capture-failed", "Region size unsupported.", false);
                int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
                if (t.X < vx || t.Y < vy || t.X + t.Width > vx + vw || t.Y + t.Height > vy + vh) return Reject("region-offscreen", "The region extends beyond the virtual desktop.", false);
                screen = GetDC(IntPtr.Zero); mem = CreateCompatibleDC(screen); bitmap = CreateCompatibleBitmap(screen, t.Width, t.Height); old = SelectObject(mem, bitmap);
                if (!BitBlt(mem, 0, 0, t.Width, t.Height, screen, t.X, t.Y, SRCCOPY | CAPTUREBLT)) return Reject("capture-failed", "BitBlt failed.", false);
                using (Bitmap bmp = Image.FromHbitmap(bitmap)) {
                    if (AllFlat(bmp)) return Reject("invalid-frame", "The captured region is a single flat colour.", false);
                    int fw, fh; string png = Encode(bmp, out fw, out fh); long id = System.Threading.Interlocked.Increment(ref frameCounter); double t1 = clock.Elapsed.TotalMilliseconds;
                    return "{\"ok\":true,\"method\":\"screen-copy\",\"width\":" + fw + ",\"height\":" + fh + ",\"dpiScale\":1,\"frameId\":" + id + ",\"hostTimeMs\":" + N(t1) + ",\"ageMs\":" + N(t1 - t0) + ",\"minimized\":false,\"occludedFraction\":0,\"bounds\":{\"x\":" + t.X + ",\"y\":" + t.Y + ",\"width\":" + t.Width + ",\"height\":" + t.Height + "},\"target\":{\"kind\":\"region\",\"x\":" + t.X + ",\"y\":" + t.Y + ",\"width\":" + t.Width + ",\"height\":" + t.Height + "},\"png\":" + Q(png) + "}";
                }
            }
            return Reject("capture-failed", "Unknown target kind.", false);
        } catch (Exception e) { return Reject("capture-failed", e.GetType().Name + ": " + e.Message, false); }
        finally {
            if (old != IntPtr.Zero && mem != IntPtr.Zero) SelectObject(mem, old);
            if (bitmap != IntPtr.Zero) DeleteObject(bitmap);
            if (mem != IntPtr.Zero) DeleteDC(mem);
            if (screen != IntPtr.Zero) ReleaseDC(IntPtr.Zero, screen);
        }
    }
    /// <summary>0.28.0: IsWindow on a handle string (used by the self-test after its window is closed; never touches a Form).</summary>
    public static bool WindowExists(string hwnd) { try { return IsWindow(ParseHandle(hwnd)); } catch (Exception) { return false; } }
    public static string AuditJson() { lock (gate) { List<string> q = new List<string>(); foreach (string a in audit) q.Add(Q(a)); return "{\"format\":\"eightmax-capture-audit\",\"version\":1,\"entries\":[" + string.Join(",", q.ToArray()) + "]}"; } }
}
}
