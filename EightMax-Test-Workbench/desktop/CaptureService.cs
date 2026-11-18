// EightMax Test Workbench 0.25 - Windows screen-capture service (C# 5 compatible; compiled together with DesktopHost.cs).
//
// What it does: lists top-level windows and monitors, and captures ONE operator-selected window client area or ONE
// operator-selected desktop region as a PNG, using documented Win32 / GDI / DWM calls only:
//   PrintWindow(PW_CLIENTONLY | PW_RENDERFULLCONTENT)  - asks the window to paint itself, so covered windows still capture
//   BitBlt(SRCCOPY | CAPTUREBLT) from the screen DC     - copies what is visible; occlusion is measured and reported
//   DwmGetWindowAttribute(DWMWA_CLOAKED)                - cloaked / other-virtual-desktop windows are reported, not captured
// Windows Graphics Capture (Windows.Graphics.Capture) is NOT implemented here: it needs WinRT projections that the
// compile-on-first-launch toolchain (.NET Framework C# 5) does not provide. This is stated in docs/SCREEN-CAPTURE.md.
//
// What it will never do: read or write another process's memory, inject code, install hooks, synthesise input, or hide
// itself. Frames are never reused: every call captures fresh pixels or reports why it could not.
// STATUS: compiled on Linux with Mono (type-checked). NOT executed on Windows in this release.
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

    /// <summary>Call once at host start. Per-monitor DPI awareness makes every size below physical pixels (what the screen really shows).</summary>
    public static string EnsureDpiAware() {
        lock (gate) {
            if (dpiSet) return "already";
            try { SetThreadDpiAwarenessContext(new IntPtr(-4)); dpiSet = true; return "per-monitor-v2 (this thread)"; }
            catch (Exception) { }
            try { SetProcessDPIAware(); dpiSet = true; return "system-aware"; } catch (Exception e) { return "unavailable: " + e.Message; }
        }
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
            return "{\"ok\":true,\"method\":" + Q(t.Method == "screen-copy" ? "screen-copy" : "print-window") + ",\"target\":{\"kind\":\"window\",\"hwnd\":" + Q(Hex(h)) + ",\"pid\":" + pid + ",\"title\":" + Q(Title(h)) + "}}";
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
    public static string AuditJson() { lock (gate) { List<string> q = new List<string>(); foreach (string a in audit) q.Add(Q(a)); return "{\"format\":\"eightmax-capture-audit\",\"version\":1,\"entries\":[" + string.Join(",", q.ToArray()) + "]}"; } }
}
}
