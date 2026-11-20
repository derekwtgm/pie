// EightMax Test Workbench 0.35.0 - platform layer of the Windows input driver.
// Win32Platform uses only documented user32/kernel32/dwmapi/shcore calls: SendInput (mouse + keyboard), GetCursorPos, SetCursorPos
// (final sub-pixel correction only), WindowFromPoint, GetWindowRect/GetClientRect/ClientToScreen, DwmGetWindowAttribute,
// GetDpiForWindow, GetGUIThreadInfo, SendMessageTimeout(WM_GETTEXT), SetForegroundWindow, GetAsyncKeyState.
// No hooks, no process-memory access, no code injection, no hidden input. VirtualPlatform is an in-memory desktop used by the
// automated tests (Mono on Linux) to execute the real protocol, motion and safety code without a Windows session.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace EightMax.Input {
public struct Rect { public int X, Y, W, H; public Rect(int x, int y, int w, int h) { X = x; Y = y; W = w; H = h; }
    public bool Contains(int px, int py) { return px >= X && py >= Y && px < X + W && py < Y + H; }
    public bool Inside(Rect o) { return X >= o.X && Y >= o.Y && X + W <= o.X + o.W && Y + H <= o.Y + o.H; }
    public bool Same(Rect o) { return X == o.X && Y == o.Y && W == o.W && H == o.H; }
    public override string ToString() { return X + "," + Y + " " + W + "x" + H; } }

public sealed class WinInfo {
    public long Hwnd; public int Pid; public long ProcessStart; public string Title = "", ClassName = "", Exe = "";
    public Rect Window, Client; public double DpiScale = 1; public bool Minimized, Visible, Cloaked, Foreground, Enabled = true; public int Monitor = -1;
}
public sealed class MonitorInfo { public int Id; public string Name = ""; public Rect Bounds, Work; public double DpiScale = 1; public bool Primary; }

public interface IPlatform {
    string Name { get; }
    Rect VirtualScreen();
    void GetCursor(out int x, out int y);
    void MoveAbsolute(int x, int y);           // SendInput absolute move over the virtual desktop
    void SetCursor(int x, int y);              // only for a final <= 2 px correction
    void Button(int button, bool down);        // 0 left, 1 right
    void Key(ushort vk, bool down);
    void Unicode(char c, bool down);
    bool IsKeyDown(ushort vk);
    WinInfo Window(long hwnd);                 // null when the handle is not a window
    long RootAt(int x, int y);                 // top-level window under a screen point
    long ChildAt(int x, int y);                // deepest enabled child under a point
    long Foreground();
    bool SetForeground(long hwnd);
    long FocusedControl(long hwnd);            // keyboard focus inside the window's GUI thread, 0 if none
    string ControlText(long ctrl);             // WM_GETTEXT with a timeout, null when unreadable
    string ControlClass(long ctrl);
    List<WinInfo> TopWindows();
    List<MonitorInfo> Monitors();
    string ExeSha256(int pid);
    long Ticks();                              // monotonic milliseconds
    int DoubleClickMs();                       // GetDoubleClickTime
    void DoubleClickSize(out int w, out int h);// SM_CXDOUBLECLK / SM_CYDOUBLECLK
}

/* ------------------------------------------------------------------------------------------------------------------ */
public sealed class Win32Platform : IPlatform {
    public string Name { get { return "win32"; } }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION u; }
    [StructLayout(LayoutKind.Sequential)] struct GUITHREADINFO { public int cbSize, flags; public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret; public RECT rcCaret; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct MONITORINFOEX { public int cbSize; public RECT rcMonitor, rcWork; public uint dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice; }
    delegate bool EnumProc(IntPtr h, IntPtr l); delegate bool MonitorEnumProc(IntPtr m, IntPtr dc, ref RECT r, IntPtr l);
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
    [DllImport("user32.dll")] static extern uint GetDoubleClickTime();
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out int pid);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GUITHREADINFO info);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, StringBuilder l, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, MonitorEnumProc p, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFOEX info);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
    [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr m, int type, out uint x, out uint y);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr p, int flags, StringBuilder s, ref int n);
    [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr p, out long create, out long exit, out long kernel, out long user);
    const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1, MOVE = 1, LDOWN = 2, LUP = 4, RDOWN = 8, RUP = 16, ABSOLUTE = 0x8000, VIRTUALDESK = 0x4000;
    const uint KEYUP = 2, UNICODE = 4, EXTENDED = 1, WM_GETTEXT = 0x000D, WM_GETTEXTLENGTH = 0x000E, SMTO_ABORTIFHUNG = 2;
    static IntPtr H(long h) { return new IntPtr(h); }
    static readonly int InputSize = Marshal.SizeOf(typeof(INPUT));
    static readonly Stopwatch clock = Stopwatch.StartNew();
    public long Ticks() { return clock.ElapsedMilliseconds; }
    public int DoubleClickMs() { return (int)GetDoubleClickTime(); }
    public void DoubleClickSize(out int w, out int h) { w = GetSystemMetrics(36); h = GetSystemMetrics(37); }
    public Rect VirtualScreen() { return new Rect(GetSystemMetrics(76), GetSystemMetrics(77), GetSystemMetrics(78), GetSystemMetrics(79)); }
    public void GetCursor(out int x, out int y) { POINT p; GetCursorPos(out p); x = p.X; y = p.Y; }
    void Send(INPUT i) { if (SendInput(1, new INPUT[] { i }, InputSize) != 1) throw new DriverError("sendinput-failed", "SendInput was refused (error " + Marshal.GetLastWin32Error() + "): another program may be blocking input, or the target runs with higher privileges (UIPI)."); }
    public void MoveAbsolute(int x, int y) {
        // Absolute virtual-desktop units: pixel = floor(dx * width / 65536). ceil(k * 65536 / width) maps back to exactly k.
        Rect v = VirtualScreen(); long kx = x - v.X, ky = y - v.Y;
        INPUT i = new INPUT(); i.type = INPUT_MOUSE; i.u.mi.dwFlags = MOVE | ABSOLUTE | VIRTUALDESK;
        i.u.mi.dx = (int)((kx * 65536 + v.W - 1) / v.W); i.u.mi.dy = (int)((ky * 65536 + v.H - 1) / v.H); Send(i);
    }
    public void SetCursor(int x, int y) { SetCursorPos(x, y); }
    public void Button(int b, bool down) { INPUT i = new INPUT(); i.type = INPUT_MOUSE; i.u.mi.dwFlags = b == 1 ? (down ? RDOWN : RUP) : (down ? LDOWN : LUP); Send(i); }
    static bool Extended(ushort vk) { return vk == 0x2D || vk == 0x2E || (vk >= 0x21 && vk <= 0x28) || vk == 0x5B || vk == 0x5C || vk == 0xA3 || vk == 0xA5; }
    public void Key(ushort vk, bool down) { INPUT i = new INPUT(); i.type = INPUT_KEYBOARD; i.u.ki.wVk = vk; i.u.ki.dwFlags = (down ? 0 : KEYUP) | (Extended(vk) ? EXTENDED : 0); Send(i); }
    public void Unicode(char c, bool down) { INPUT i = new INPUT(); i.type = INPUT_KEYBOARD; i.u.ki.wScan = c; i.u.ki.dwFlags = UNICODE | (down ? 0 : KEYUP); Send(i); }
    public bool IsKeyDown(ushort vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }
    static string Text(IntPtr h) { StringBuilder s = new StringBuilder(512); GetWindowText(h, s, s.Capacity); return s.ToString(); }
    static string Cls(IntPtr h) { StringBuilder s = new StringBuilder(256); GetClassName(h, s, s.Capacity); return s.ToString(); }
    static Rect R(RECT r) { return new Rect(r.L, r.T, r.R - r.L, r.B - r.T); }
    public WinInfo Window(long hwnd) {
        IntPtr h = H(hwnd); if (hwnd == 0 || !IsWindow(h)) return null;
        WinInfo w = new WinInfo(); w.Hwnd = hwnd; GetWindowThreadProcessId(h, out w.Pid); w.Title = Text(h); w.ClassName = Cls(h);
        RECT r; if (DwmGetWindowAttribute(h, 9 /*DWMWA_EXTENDED_FRAME_BOUNDS*/, out r, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(h, out r); w.Window = R(r);
        RECT c; GetClientRect(h, out c); POINT o = new POINT(); ClientToScreen(h, ref o); w.Client = new Rect(o.X, o.Y, c.R - c.L, c.B - c.T);
        w.Minimized = IsIconic(h); w.Visible = IsWindowVisible(h); w.Enabled = IsWindowEnabled(h); w.Foreground = GetForegroundWindow() == h;
        int cloak; w.Cloaked = DwmGetWindowAttribute(h, 14 /*DWMWA_CLOAKED*/, out cloak, 4) == 0 && cloak != 0;
        try { uint dpi = GetDpiForWindow(h); if (dpi > 0) w.DpiScale = dpi / 96.0; } catch (EntryPointNotFoundException) { }
        IntPtr p = OpenProcess(0x1000 /*QUERY_LIMITED_INFORMATION*/, false, w.Pid);
        if (p != IntPtr.Zero) { try { StringBuilder s = new StringBuilder(1024); int n = s.Capacity; if (QueryFullProcessImageName(p, 0, s, ref n)) w.Exe = s.ToString(); long cr, ex, k, u; if (GetProcessTimes(p, out cr, out ex, out k, out u)) w.ProcessStart = cr; } finally { CloseHandle(p); } }
        IntPtr mon = MonitorFromWindow(h, 2); List<MonitorInfo> ms = Monitors(); for (int i = 0; i < ms.Count; i++) if (MonitorHandles.Count > i && MonitorHandles[i] == mon) w.Monitor = ms[i].Id;
        return w;
    }
    List<IntPtr> MonitorHandles = new List<IntPtr>();
    public long RootAt(int x, int y) { POINT p; p.X = x; p.Y = y; IntPtr h = WindowFromPoint(p); return h == IntPtr.Zero ? 0 : GetAncestor(h, 2 /*GA_ROOT*/).ToInt64(); }
    public long ChildAt(int x, int y) { POINT p; p.X = x; p.Y = y; return WindowFromPoint(p).ToInt64(); }
    public long Foreground() { return GetForegroundWindow().ToInt64(); }
    public bool SetForeground(long hwnd) {
        IntPtr h = H(hwnd); if (SetForegroundWindow(h) && GetForegroundWindow() == h) return true;
        // Documented fallback: share input state with the current foreground thread for the duration of the call, then detach.
        int pid; uint fg = GetWindowThreadProcessId(GetForegroundWindow(), out pid), me = GetCurrentThreadId();
        bool attached = fg != 0 && fg != me && AttachThreadInput(me, fg, true);
        try { BringWindowToTop(h); SetForegroundWindow(h); } finally { if (attached) AttachThreadInput(me, fg, false); }
        return GetForegroundWindow() == h;
    }
    public long FocusedControl(long hwnd) {
        int pid; uint thread = GetWindowThreadProcessId(H(hwnd), out pid); if (thread == 0) return 0;
        GUITHREADINFO g = new GUITHREADINFO(); g.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO)); return GetGUIThreadInfo(thread, ref g) ? g.hwndFocus.ToInt64() : 0;
    }
    public string ControlText(long ctrl) {
        IntPtr res, h = H(ctrl); if (!IsWindow(h)) return null;
        if (SendMessageTimeout(h, WM_GETTEXTLENGTH, IntPtr.Zero, IntPtr.Zero, SMTO_ABORTIFHUNG, 500, out res) == IntPtr.Zero) return null;
        int n = Math.Min(4096, res.ToInt32()); StringBuilder s = new StringBuilder(n + 2);
        if (SendMessageTimeout(h, WM_GETTEXT, new IntPtr(n + 1), s, SMTO_ABORTIFHUNG, 500, out res) == IntPtr.Zero) return null; return s.ToString();
    }
    public string ControlClass(long ctrl) { return ctrl == 0 ? "" : Cls(H(ctrl)); }
    public List<WinInfo> TopWindows() {
        List<long> hs = new List<long>(); EnumWindows(delegate(IntPtr h, IntPtr l) { if (IsWindowVisible(h)) hs.Add(h.ToInt64()); return true; }, IntPtr.Zero);
        List<WinInfo> list = new List<WinInfo>(); foreach (long h in hs) { WinInfo w = Window(h); if (w != null && w.Title.Length > 0 && !w.Cloaked) list.Add(w); } return list;
    }
    public List<MonitorInfo> Monitors() {
        List<MonitorInfo> list = new List<MonitorInfo>(); List<IntPtr> handles = new List<IntPtr>();
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(IntPtr m, IntPtr dc, ref RECT r, IntPtr l) {
            MONITORINFOEX info = new MONITORINFOEX(); info.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX)); GetMonitorInfo(m, ref info);
            MonitorInfo mi = new MonitorInfo(); mi.Id = list.Count; mi.Name = info.szDevice ?? ""; mi.Bounds = R(info.rcMonitor); mi.Work = R(info.rcWork); mi.Primary = (info.dwFlags & 1) != 0;
            try { uint dx, dy; if (GetDpiForMonitor(m, 0, out dx, out dy) == 0) mi.DpiScale = dx / 96.0; } catch (DllNotFoundException) { } catch (EntryPointNotFoundException) { }
            list.Add(mi); handles.Add(m); return true; }, IntPtr.Zero);
        MonitorHandles = handles; return list;
    }
    public string ExeSha256(int pid) {
        IntPtr p = OpenProcess(0x1000, false, pid); if (p == IntPtr.Zero) return null; string path;
        try { StringBuilder s = new StringBuilder(1024); int n = s.Capacity; if (!QueryFullProcessImageName(p, 0, s, ref n)) return null; path = s.ToString(); } finally { CloseHandle(p); }
        using (SHA256 sha = SHA256.Create()) using (FileStream f = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete)) return BitConverter.ToString(sha.ComputeHash(f)).Replace("-", "").ToLowerInvariant();
    }
}

/* ------------------------------------------------------------------------------------------------------------------ */
/// <summary>In-memory desktop for automated tests. Windows and controls come from a JSON description; every injected event is recorded.</summary>
public sealed class VirtualPlatform : IPlatform {
    public string Name { get { return "virtual"; } }
    public sealed class VControl { public long Hwnd; public string Class = "Button", Text = ""; public Rect Box; public bool Enabled = true; public int Clicks; }
    public sealed class VWindow { public WinInfo Info = new WinInfo(); public List<VControl> Controls = new List<VControl>(); public long Focus; }
    public readonly List<VWindow> Windows = new List<VWindow>(); public readonly List<string> Events = new List<string>();
    public Rect Screen = new Rect(0, 0, 1920, 1080); int cx = 10, cy = 10; long foreground; readonly HashSet<ushort> keys = new HashSet<ushort>(); readonly bool[] buttons = new bool[2];
    readonly Stopwatch clock = Stopwatch.StartNew(); public long Ticks() { return clock.ElapsedMilliseconds; }
    public int DoubleClickMs() { return 500; } public void DoubleClickSize(out int w, out int h) { w = 4; h = 4; }
    public int Dropped; public bool RefuseForeground;   // test knobs
    public Rect VirtualScreen() { return Screen; }
    public void GetCursor(out int x, out int y) { lock (this) { x = cx; y = cy; } }
    public void MoveAbsolute(int x, int y) { lock (this) { cx = Math.Max(Screen.X, Math.Min(Screen.X + Screen.W - 1, x)); cy = Math.Max(Screen.Y, Math.Min(Screen.Y + Screen.H - 1, y)); if (Events.Count < 200000) Events.Add("move " + cx + " " + cy + " " + Ticks()); } }
    public void SetCursor(int x, int y) { lock (this) { cx = x; cy = y; Events.Add("set " + x + " " + y); } }
    /// <summary>Test hook: a person moves the mouse.</summary>
    public void UserMove(int x, int y) { lock (this) { cx = x; cy = y; Events.Add("user-move " + x + " " + y); } }
    public void Button(int b, bool down) { lock (this) {
        buttons[b] = down; Events.Add((down ? "down " : "up ") + b + " " + cx + " " + cy);
        long root = RootAt(cx, cy); if (down && root != 0) foreground = root;
        if (!down && b == 0) { VControl c = ControlAt(cx, cy); if (c != null && c.Enabled) { c.Clicks++; VWindow w = Find(root); if (w != null) w.Focus = c.Hwnd; Events.Add("click " + c.Text); } } } }
    public void Key(ushort vk, bool down) { lock (this) { if (down) keys.Add(vk); else keys.Remove(vk); Events.Add((down ? "kdown " : "kup ") + vk); if (down) Typed(vk, (char)0); } }
    public void Unicode(char c, bool down) { lock (this) { Events.Add((down ? "udown " : "uup ") + (int)c); if (down) Typed(0, c); } }
    void Typed(ushort vk, char c) {
        VWindow w = Find(foreground); if (w == null) return; VControl f = null; foreach (VControl x in w.Controls) if (x.Hwnd == w.Focus) f = x; if (f == null || f.Class.IndexOf("edit", StringComparison.OrdinalIgnoreCase) < 0) return;
        if (vk == 0x08) { if (f.Text.Length > 0) f.Text = f.Text.Substring(0, f.Text.Length - 1); }
        else if (vk == 0x2E) { } else if (vk >= 0x30 && vk <= 0x39) f.Text += (char)vk; else if (vk == 0xBE || vk == 0x6E) f.Text += "."; else if (c != 0) f.Text += c;
    }
    public bool IsKeyDown(ushort vk) { lock (this) { return vk == 1 ? buttons[0] : vk == 2 ? buttons[1] : keys.Contains(vk); } }
    VWindow Find(long h) { foreach (VWindow w in Windows) if (w.Info.Hwnd == h) return w; return null; }
    VControl ControlAt(int x, int y) { VWindow w = Find(RootAt(x, y)); if (w == null) return null; foreach (VControl c in w.Controls) if (c.Box.Contains(x, y)) return c; return null; }
    public WinInfo Window(long hwnd) { lock (this) { VWindow w = Find(hwnd); if (w == null) return null; WinInfo i = w.Info; i.Foreground = foreground == hwnd; return i; } }
    public long RootAt(int x, int y) { lock (this) { for (int i = Windows.Count - 1; i >= 0; i--) { WinInfo w = Windows[i].Info; if (!w.Minimized && w.Window.Contains(x, y)) return w.Hwnd; } return 0; } }
    public long ChildAt(int x, int y) { lock (this) { VControl c = ControlAt(x, y); return c != null && c.Enabled ? c.Hwnd : RootAt(x, y); } }
    public long Foreground() { return foreground; }
    public bool SetForeground(long hwnd) { lock (this) { if (RefuseForeground || Find(hwnd) == null) return false; foreground = hwnd; VWindow w = Find(hwnd); Windows.Remove(w); Windows.Add(w); return true; } }
    public long FocusedControl(long hwnd) { lock (this) { VWindow w = Find(hwnd); return w == null ? 0 : w.Focus; } }
    public string ControlText(long ctrl) { lock (this) { foreach (VWindow w in Windows) foreach (VControl c in w.Controls) if (c.Hwnd == ctrl) return c.Text; return null; } }
    public string ControlClass(long ctrl) { lock (this) { foreach (VWindow w in Windows) foreach (VControl c in w.Controls) if (c.Hwnd == ctrl) return c.Class; return ""; } }
    public List<WinInfo> TopWindows() { lock (this) { List<WinInfo> l = new List<WinInfo>(); foreach (VWindow w in Windows) l.Add(w.Info); return l; } }
    public List<MonitorInfo> Monitors() { MonitorInfo m = new MonitorInfo(); m.Bounds = Screen; m.Work = Screen; m.Primary = true; m.Name = "VIRTUAL1"; return new List<MonitorInfo> { m }; }
    public string ExeSha256(int pid) { return "0000000000000000000000000000000000000000000000000000000000000000".Substring(0, 56) + pid.ToString("x8"); }
    /// <summary>Load {"screen":{x,y,w,h},"windows":[{hwnd,pid,start,title,class,exe,window:{..},client:{..},dpi,controls:[{hwnd,class,text,box,enabled}]}]}.</summary>
    public static VirtualPlatform Load(string path) {
        VirtualPlatform v = new VirtualPlatform(); var js = new System.Web.Script.Serialization.JavaScriptSerializer();
        Dictionary<string, object> d = (Dictionary<string, object>)js.DeserializeObject(File.ReadAllText(path));
        if (d.ContainsKey("screen")) v.Screen = Json.Box(d["screen"]);
        foreach (object o in (System.Collections.IList)d["windows"]) { Dictionary<string, object> w = (Dictionary<string, object>)o; VWindow vw = new VWindow();
            vw.Info.Hwnd = Convert.ToInt64(w["hwnd"]); vw.Info.Pid = Convert.ToInt32(w["pid"]); vw.Info.ProcessStart = w.ContainsKey("start") ? Convert.ToInt64(w["start"]) : 1;
            vw.Info.Title = (string)w["title"]; vw.Info.ClassName = w.ContainsKey("class") ? (string)w["class"] : "WindowsForms10"; vw.Info.Exe = w.ContainsKey("exe") ? (string)w["exe"] : "C:\\test\\table.exe";
            vw.Info.Window = Json.Box(w["window"]); vw.Info.Client = Json.Box(w["client"]); vw.Info.DpiScale = w.ContainsKey("dpi") ? Convert.ToDouble(w["dpi"]) : 1; vw.Info.Visible = true;
            if (w.ContainsKey("controls")) foreach (object co in (System.Collections.IList)w["controls"]) { Dictionary<string, object> c = (Dictionary<string, object>)co; VControl vc = new VControl();
                vc.Hwnd = Convert.ToInt64(c["hwnd"]); vc.Class = (string)c["class"]; vc.Text = c.ContainsKey("text") ? (string)c["text"] : ""; vc.Box = Json.Box(c["box"]); vc.Enabled = !c.ContainsKey("enabled") || (bool)c["enabled"]; vw.Controls.Add(vc); }
            v.Windows.Add(vw); }
        if (v.Windows.Count > 0) v.foreground = v.Windows[v.Windows.Count - 1].Info.Hwnd; return v;
    }
}
}
