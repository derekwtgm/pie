// EightMax Test Workbench 0.35.0 - Windows Graphics Capture self-test (own Win32 test window; no other program is captured).
// Stages: create-window, session-start, first-frame, verify-original-pixels, resize (resolution-change detection + verify), refuse-wrong-process,
// minimize (detected, no frames), restore (frames resume = interruption recovery), repeated-sessions (memory cleanup),
// close-window (target-lost), refuse-closed-handle. Writes wgc-selftest-result.json; exit 0 only if every stage passed.
// STATUS: COMPILED ONLY (cross-compiled on Linux). NOT EXECUTED ON WINDOWS.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace EightMax.Workbench.Wgc {

/// <summary>A plain Win32 popup window (no frame, so the captured image equals the client area) with four coloured quadrants.</summary>
sealed class TestWindow : IDisposable {
    delegate IntPtr WndProc(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct WNDCLASSEX { public int cbSize; public uint style; public WndProc lpfnWndProc; public int cbClsExtra, cbWndExtra; public IntPtr hInstance, hIcon, hCursor, hbrBackground; public string lpszMenuName, lpszClassName; public IntPtr hIconSm; }
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct PAINTSTRUCT { public IntPtr hdc; public int fErase; public RECT rcPaint; public int fRestore, fIncUpdate; [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)] public byte[] rgbReserved; }
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public int x, y; }
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern ushort RegisterClassEx(ref WNDCLASSEX c);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateWindowEx(uint ex, string cls, string title, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr inst, IntPtr param);
    [DllImport("user32.dll")] static extern IntPtr DefWindowProc(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr h);
    [DllImport("user32.dll")] static extern void PostQuitMessage(int code);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint min, uint max);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG m);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG m);
    [DllImport("user32.dll")] static extern IntPtr BeginPaint(IntPtr h, out PAINTSTRUCT p);
    [DllImport("user32.dll")] static extern bool EndPaint(IntPtr h, ref PAINTSTRUCT p);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern int FillRect(IntPtr dc, ref RECT r, IntPtr brush);
    [DllImport("user32.dll")] static extern bool InvalidateRect(IntPtr h, IntPtr r, bool erase);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hgt, uint flags);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("gdi32.dll")] static extern IntPtr CreateSolidBrush(uint colorref);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr o);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);

    public static readonly byte[][] Colors = { new byte[] { 220, 30, 30 }, new byte[] { 30, 200, 40 }, new byte[] { 40, 60, 230 }, new byte[] { 240, 220, 20 } };
    readonly WndProc proc; readonly Thread thread; readonly ManualResetEventSlim created = new ManualResetEventSlim(false);
    public IntPtr Handle { get; private set; }
    public string Error;
    public TestWindow(int x, int y, int w, int h, string title) {
        proc = Proc;
        thread = new Thread(() => {
            try {
                string cls = "EightMaxWgcSelfTest" + Environment.ProcessId;
                var wc = new WNDCLASSEX { cbSize = Marshal.SizeOf<WNDCLASSEX>(), lpfnWndProc = proc, hInstance = GetModuleHandle(null), lpszClassName = cls };
                if (RegisterClassEx(ref wc) == 0) throw new Exception("RegisterClassEx failed (" + Marshal.GetLastWin32Error() + ")");
                Handle = CreateWindowEx(0x00040000 /*WS_EX_APPWINDOW*/, cls, title, 0x80000000u /*WS_POPUP*/ | 0x10000000u /*WS_VISIBLE*/ | 0x00020000u /*WS_MINIMIZEBOX*/, x, y, w, h, IntPtr.Zero, IntPtr.Zero, wc.hInstance, IntPtr.Zero);
                if (Handle == IntPtr.Zero) throw new Exception("CreateWindowEx failed (" + Marshal.GetLastWin32Error() + ")");
                SetForegroundWindow(Handle);
            } catch (Exception e) { Error = e.Message; }
            created.Set();
            if (Handle == IntPtr.Zero) return;
            MSG m; while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) { TranslateMessage(ref m); DispatchMessage(ref m); }
        }) { IsBackground = true, Name = "wgc-selftest-window" };
        thread.SetApartmentState(ApartmentState.STA); thread.Start(); created.Wait(5000);
    }
    IntPtr Proc(IntPtr h, uint msg, IntPtr w, IntPtr l) {
        switch (msg) {
            case 0x000F: { // WM_PAINT
                PAINTSTRUCT ps; IntPtr dc = BeginPaint(h, out ps); RECT c; GetClientRect(h, out c); int hw = (c.Right - c.Left) / 2, hh = (c.Bottom - c.Top) / 2;
                for (int i = 0; i < 4; i++) { var r = new RECT { Left = (i % 2) * hw, Top = (i / 2) * hh, Right = (i % 2) * hw + hw, Bottom = (i / 2) * hh + hh }; if (i % 2 == 1) r.Right = c.Right; if (i / 2 == 1) r.Bottom = c.Bottom; IntPtr b = CreateSolidBrush((uint)(Colors[i][0] | Colors[i][1] << 8 | Colors[i][2] << 16)); FillRect(dc, ref r, b); DeleteObject(b); }
                EndPaint(h, ref ps); return IntPtr.Zero; }
            case 0x0005: InvalidateRect(h, IntPtr.Zero, false); break; // WM_SIZE
            case 0x0010: DestroyWindow(h); return IntPtr.Zero;         // WM_CLOSE
            case 0x0002: PostQuitMessage(0); return IntPtr.Zero;        // WM_DESTROY
        }
        return DefWindowProc(h, msg, w, l);
    }
    public void Resize(int w, int h) { SetWindowPos(Handle, IntPtr.Zero, 0, 0, w, h, 0x0002 /*NOMOVE*/ | 0x0004 /*NOZORDER*/); InvalidateRect(Handle, IntPtr.Zero, false); }
    public void Minimize() { ShowWindow(Handle, 6 /*SW_MINIMIZE*/); }
    public void Restore() { ShowWindow(Handle, 9 /*SW_RESTORE*/); InvalidateRect(Handle, IntPtr.Zero, false); }
    public void Repaint() { InvalidateRect(Handle, IntPtr.Zero, false); }
    public void Close() { PostMessage(Handle, 0x0010, IntPtr.Zero, IntPtr.Zero); thread.Join(5000); }
    public void Dispose() { if (Native.IsWindow(Handle)) Close(); }
}

static class SelfTest {
    sealed class Stage { public string Name, Status, Detail; public double Ms; }
    static readonly List<Stage> stages = new List<Stage>();
    static void Record(string name, bool pass, string detail, double ms) { stages.Add(new Stage { Name = name, Status = pass ? "pass" : "fail", Detail = detail ?? "", Ms = ms }); Console.Error.WriteLine((pass ? "PASS " : "FAIL ") + name + " - " + detail); }
    static string Quadrants(Frame f, out int bad) {
        bad = 0; var d = new StringBuilder(); int w = f.Width, h = f.Height;
        int[][] pts = { new[] { w / 4, h / 4 }, new[] { 3 * w / 4, h / 4 }, new[] { w / 4, 3 * h / 4 }, new[] { 3 * w / 4, 3 * h / 4 } };
        for (int i = 0; i < 4; i++) { int o = (pts[i][1] * w + pts[i][0]) * 4; int b = f.Bgra[o], g = f.Bgra[o + 1], r = f.Bgra[o + 2]; var c = TestWindow.Colors[i]; if (Math.Abs(r - c[0]) > 12 || Math.Abs(g - c[1]) > 12 || Math.Abs(b - c[2]) > 12) { bad++; d.Append("quadrant " + i + " " + r + "," + g + "," + b + " != " + c[0] + "," + c[1] + "," + c[2] + "; "); } }
        return d.Append(w + "x" + h).ToString();
    }
    public static int Run(string dir) {
        Directory.CreateDirectory(dir); var total = Stopwatch.StartNew(); string current = "create-window"; int harness = 0; TestWindow win = null; WgcSession s = null; string hwnd = null;
        try {
            var sw = Stopwatch.StartNew();
            win = new TestWindow(60, 60, 640, 400, "EightMax WGC self-test " + Environment.ProcessId);
            Record("create-window", win.Handle != IntPtr.Zero, win.Error ?? "hwnd=0x" + win.Handle.ToInt64().ToString("x") + " dpiScale=" + Json.N(Native.GetDpiForWindow(win.Handle) / 96.0), sw.Elapsed.TotalMilliseconds);
            if (win.Handle == IntPtr.Zero) throw new Exception("test window was not created");
            hwnd = "0x" + win.Handle.ToInt64().ToString("x"); Thread.Sleep(300);
            current = "session-start"; sw.Restart();
            s = new WgcSession(win.Handle, false, Environment.ProcessId, 4, 0); s.Start();
            Record("session-start", true, "device=" + s.DeviceKind + " size=" + s.Size.Width + "x" + s.Size.Height, sw.Elapsed.TotalMilliseconds);
            current = "first-frame"; sw.Restart(); win.Repaint();
            var f = s.WaitFrame(3000, null);
            Record("first-frame", f != null, f == null ? "no frame within 3000 ms" + (s.LastError != null ? " (" + s.LastError + ")" : "") : "seq=" + f.Seq + " " + f.Width + "x" + f.Height + " ageMs=" + Json.N(f.AgeMs) + " latencyMs=" + Json.N(sw.Elapsed.TotalMilliseconds), sw.Elapsed.TotalMilliseconds);
            if (f != null) { int bad; string q = Quadrants(f, out bad); Png.WriteBgra(Path.Combine(dir, "wgc-selftest-0.png"), f.Bgra, f.Width, f.Height); Record("verify-original-pixels", bad == 0 && Math.Abs(f.Width - 640) <= 2 && Math.Abs(f.Height - 400) <= 2, q + " (expected 640x400)", 0); }
            current = "resize"; sw.Restart(); long resizesBefore = s.Resizes;
            win.Resize(800, 500);
            Frame r = null; for (int i = 0; i < 40 && r == null; i++) { win.Repaint(); r = s.WaitFrame(100, x => Math.Abs(x.Width - 800) <= 2 && Math.Abs(x.Height - 500) <= 2); }
            Record("resize-detected", s.Resizes > resizesBefore && r != null, "resizes=" + (s.Resizes - resizesBefore) + " frame=" + (r == null ? "none" : r.Width + "x" + r.Height), sw.Elapsed.TotalMilliseconds);
            if (r != null) { int bad; string q = Quadrants(r, out bad); Png.WriteBgra(Path.Combine(dir, "wgc-selftest-1.png"), r.Bgra, r.Width, r.Height); Record("verify-resized-pixels", bad == 0, q, 0); }
            current = "refuse-wrong-process"; sw.Restart(); string wp = "";
            try { Program.CheckWindow(win.Handle, Environment.ProcessId + 1); } catch (CaptureRefused c) { wp = c.Code; }
            Record("refuse-wrong-process", wp == "target-identity-changed", "refusal=" + wp + " (handle checked against another process id)", sw.Elapsed.TotalMilliseconds);
            current = "minimize"; sw.Restart();
            win.Minimize(); Thread.Sleep(400); s.TakeLatest();
            bool refused = false; string code = ""; try { Program.CheckWindow(win.Handle, Environment.ProcessId); } catch (CaptureRefused c) { refused = c.Code == "target-minimized"; code = c.Code; }
            Record("detect-minimized", refused && Native.IsIconic(win.Handle), "IsIconic=" + Native.IsIconic(win.Handle) + " refusal=" + code, sw.Elapsed.TotalMilliseconds);
            current = "restore"; sw.Restart(); win.Restore();
            Frame back = null; for (int i = 0; i < 30 && back == null; i++) { win.Repaint(); back = s.WaitFrame(100, null); }
            Record("recover-after-restore", back != null && !back.Blank, back == null ? "no frame after restore within 3 s" : "seq=" + back.Seq + " " + back.Width + "x" + back.Height, sw.Elapsed.TotalMilliseconds);
            Record("frame-sequence", back != null && f != null && back.Seq > f.Seq, "first=" + (f == null ? 0 : f.Seq) + " latest=" + (back == null ? 0 : back.Seq) + " dropped=" + s.Dropped + " blank=" + s.Blank, 0);
            s.Dispose(); s = null;
            current = "repeated-sessions"; sw.Restart();
            GC.Collect(); GC.WaitForPendingFinalizers(); long before = Environment.WorkingSet; int ok = 0;
            for (int i = 0; i < 5; i++) { using (var again = new WgcSession(win.Handle, false, Environment.ProcessId, 2, 0)) { again.Start(); win.Repaint(); if (again.WaitFrame(2000, null) != null) ok++; } }
            GC.Collect(); GC.WaitForPendingFinalizers(); long growth = (Environment.WorkingSet - before) / 1048576;
            Record("repeated-sessions-and-cleanup", ok == 5 && growth < 64, ok + "/5 sessions produced a frame; working-set growth " + growth + " MiB (limit 64)", sw.Elapsed.TotalMilliseconds);
            current = "close-window"; sw.Restart();
            s = new WgcSession(win.Handle, false, Environment.ProcessId, 2, 0); s.Start(); win.Repaint(); s.WaitFrame(1000, null);
            win.Close(); Thread.Sleep(300);
            bool lostSeen = s.ItemClosed || !Native.IsWindow(win.Handle);
            Record("detect-closed", lostSeen && !Native.IsWindow(win.Handle), "IsWindow=" + Native.IsWindow(win.Handle) + " itemClosedEvent=" + s.ItemClosed, sw.Elapsed.TotalMilliseconds);
            s.Dispose(); s = null;
            current = "refuse-closed-handle"; sw.Restart(); string rc = "";
            try { Program.CheckWindow(Native.ParseHandle(hwnd), Environment.ProcessId); } catch (CaptureRefused c) { rc = c.Code; }
            Record("refuse-closed-handle", rc == "target-lost", "refusal=" + rc, sw.Elapsed.TotalMilliseconds);
        } catch (Exception e) { harness++; Record(current, false, "harness exception " + e.GetType().Name + ": " + e.Message, 0); }
        finally { try { s?.Dispose(); } catch (Exception) { } try { win?.Dispose(); } catch (Exception) { } }
        string[] required = { "create-window", "session-start", "first-frame", "verify-original-pixels", "resize-detected", "verify-resized-pixels", "refuse-wrong-process", "detect-minimized", "recover-after-restore", "frame-sequence", "repeated-sessions-and-cleanup", "detect-closed", "refuse-closed-handle" };
        var missing = new List<string>(); foreach (var name in required) if (!stages.Exists(x => x.Name == name)) missing.Add(name);
        int failures = stages.FindAll(x => x.Status != "pass").Count; bool passed = failures == 0 && missing.Count == 0;
        var j = new StringBuilder("{\"format\":\"eightmax-wgc-selftest\",\"version\":1,\"toolVersion\":\"" + Program.Version + "\",\"os\":" + Json.Q(Environment.OSVersion.VersionString) + ",\"stages\":[");
        for (int i = 0; i < stages.Count; i++) { var st = stages[i]; if (i > 0) j.Append(','); j.Append("{\"stage\":" + Json.Q(st.Name) + ",\"status\":" + Json.Q(st.Status) + ",\"detail\":" + Json.Q(st.Detail) + ",\"ms\":" + Json.N(st.Ms) + "}"); }
        j.Append("],\"missingStages\":[" + string.Join(",", missing.ConvertAll(Json.Q)) + "],\"failures\":" + failures + ",\"harnessErrors\":" + harness + ",\"passed\":" + (passed ? "true" : "false") + ",\"durationMs\":" + total.ElapsedMilliseconds + "}");
        File.WriteAllText(Path.Combine(dir, "wgc-selftest-result.json"), j.ToString(), new UTF8Encoding(false));
        Json.Line(j.ToString());
        return harness > 0 ? 4 : passed ? 0 : 1;
    }
}
}
