// EightMax Test Workbench 0.35.0 - stand-alone capture tool (used by the Windows acceptance script and for diagnostics).
// Compiled together with ../CaptureService.cs. C# 5 compatible. Cross-compiled on Linux (Mono); see docs/RELEASE-STATUS-0.28.md for what ran where.
//   EightMaxCapture.exe list-windows | list-monitors
//   EightMaxCapture.exe capture-window <hwnd> <pid> <out.png> [title] [auto|print-window|screen-copy]
//   EightMaxCapture.exe capture-region <x> <y> <w> <h> <out.png>
//   EightMaxCapture.exe selftest <out-dir>     (own window: capture, resize, minimise, restore, close; writes selftest-result.json)
//   EightMaxCapture.exe version
// Exit codes: 0 pass, 1 a check failed, 2 usage, 3 capture refused, 4 harness exception (never an unhandled crash).
using System;
using System.Drawing;
using System.IO;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using System.Text;
using EightMax.Workbench;

[assembly: System.Reflection.AssemblyTitle("EightMax capture tool")]
[assembly: System.Reflection.AssemblyProduct("EightMax Test Workbench")]
[assembly: System.Reflection.AssemblyVersion("0.35.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("0.35.0.0")]
[assembly: System.Reflection.AssemblyInformationalVersion("0.35.0")]
public static class EightMaxCapture {
    public const string ToolVersion = "0.35.0";
    static string Field(string json, string name) {
        JavaScriptSerializer s = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        Dictionary<string, object> d = (Dictionary<string, object>)s.DeserializeObject(json); object v; return d.TryGetValue(name, out v) && v != null ? v.ToString() : null;
    }
    static int Save(string reply, string path) {
        string ok = Field(reply, "ok");
        if (ok != "True") { Console.Error.WriteLine(Field(reply, "code") + ": " + Field(reply, "reason")); return 3; }
        File.WriteAllBytes(path, Convert.FromBase64String(Field(reply, "png")));
        Console.WriteLine("saved " + path + " " + Field(reply, "width") + "x" + Field(reply, "height") + " method=" + Field(reply, "method") + " dpiScale=" + Field(reply, "dpiScale") + " occluded=" + Field(reply, "occludedFraction"));
        return 0;
    }
    [STAThread] public static int Main(string[] a) {
        if (a.Length == 0) { Console.Error.WriteLine("usage: version | list-windows | list-monitors | capture-window | capture-region | selftest"); return 2; }
        AppDomain.CurrentDomain.UnhandledException += delegate(object s, UnhandledExceptionEventArgs e) { Console.WriteLine("FATAL " + (e.ExceptionObject is Exception ? ((Exception)e.ExceptionObject).GetType().Name + ": " + ((Exception)e.ExceptionObject).Message : "unknown")); Environment.Exit(4); };
        Application.ThreadException += delegate(object s, System.Threading.ThreadExceptionEventArgs e) { Console.WriteLine("FATAL " + e.Exception.GetType().Name + ": " + e.Exception.Message); Environment.Exit(4); };
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        string dpiMode = CaptureService.EnsureDpiAware();
        switch (a[0]) {
            case "version": Console.WriteLine("{\"tool\":\"EightMaxCapture\",\"version\":\"" + ToolVersion + "\",\"dpiAwareness\":\"" + dpiMode + "\"}"); return 0;
            case "list-windows": Console.WriteLine(CaptureService.ListWindowsJson(System.Diagnostics.Process.GetCurrentProcess().Id)); return 0;
            case "list-monitors": Console.WriteLine(CaptureService.ListMonitorsJson()); return 0;
            case "capture-window": {
                CaptureService.Target t = new CaptureService.Target { Kind = "window", Hwnd = a[1], Pid = int.Parse(a[2]), Title = a.Length > 4 ? a[4] : null, Method = a.Length > 5 ? a[5] : "auto" };
                return Save(CaptureService.GrabJson(t), a[3]);
            }
            case "capture-region": {
                CaptureService.Target t = new CaptureService.Target { Kind = "region", X = int.Parse(a[1]), Y = int.Parse(a[2]), Width = int.Parse(a[3]), Height = int.Parse(a[4]) };
                return Save(CaptureService.GrabJson(t), a[5]);
            }
            case "selftest": return SelfTest(a.Length > 1 ? a[1] : ".");
        }
        Console.Error.WriteLine("unknown command"); return 2;
    }
    // ---- 0.28.0 self-test --------------------------------------------------------------------------------------------
    // 0.26.0 defect (seen on the target PC, Windows 11 26300, 150 % scaling): after f.Close() the test read f.Handle.
    // Close() on a modeless form disposes it, so Control.Handle threw ObjectDisposedException, the process died with an
    // unhandled exception right after "minimised window correctly reported", and the closed-window check never ran.
    // Now: the native handle is captured ONCE while the window is alive and is never read from the Form again; every
    // stage runs inside its own try/catch, is written to selftest-result.json with its exact stage name, and the process
    // always reaches its summary line and a defined exit code (0 pass, 1 check failed, 4 harness exception).
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    sealed class Stage { public string Name, Status, Detail; public double Ms; }
    static readonly List<Stage> stages = new List<Stage>();
    static void Record(string name, bool pass, string detail, double ms) {
        Stage st = new Stage { Name = name, Status = pass ? "pass" : "fail", Detail = detail ?? "", Ms = ms }; stages.Add(st);
        string line = (pass ? "PASS " : "FAIL ") + name + (detail != null && detail.Length > 0 ? " - " + detail : "");
        Console.WriteLine(line); // stdout only: the PowerShell harness must not turn diagnostics into terminating errors
    }
    static void Pump(int ms) { DateTime end = DateTime.UtcNow.AddMilliseconds(ms); do { Application.DoEvents(); System.Threading.Thread.Sleep(15); } while (DateTime.UtcNow < end); }
    static string Short(string s) { return s == null ? "" : s.Length > 160 ? s.Substring(0, 160) + "..." : s; }
    static string Js(string s) { if (s == null) return "null"; StringBuilder b = new StringBuilder("\""); foreach (char c in s) { if (c == '"' || c == '\\') b.Append('\\').Append(c); else if (c < 32) b.AppendFormat("\\u{0:x4}", (int)c); else b.Append(c); } return b.Append('"').ToString(); }
    /// <summary>Pure check used by the self-test and by tests: is a capture reply the expected rejection code?</summary>
    public static bool IsCode(string reply, string code) { try { return Field(reply, "ok") == "False" && Field(reply, "code") == code; } catch (Exception) { return false; } }
    static int CheckQuadrants(string png, Color[] q, out string detail) {
        int bad = 0; StringBuilder d = new StringBuilder();
        using (Bitmap b = new Bitmap(png)) {
            int w = b.Width, h = b.Height; Point[] pts = new Point[] { new Point(w / 4, h / 4), new Point(3 * w / 4, h / 4), new Point(w / 4, 3 * h / 4), new Point(3 * w / 4, 3 * h / 4) };
            for (int i = 0; i < 4; i++) { Color c = b.GetPixel(pts[i].X, pts[i].Y); if (Math.Abs(c.R - q[i].R) > 12 || Math.Abs(c.G - q[i].G) > 12 || Math.Abs(c.B - q[i].B) > 12) { bad++; d.Append("quadrant " + i + " " + c.R + "," + c.G + "," + c.B + " != " + q[i].R + "," + q[i].G + "," + q[i].B + "; "); } }
            d.Append(w + "x" + h);
        }
        detail = d.ToString(); return bad;
    }
    static int SelfTest(string dir) {
        Directory.CreateDirectory(dir); stages.Clear();
        System.Diagnostics.Stopwatch total = System.Diagnostics.Stopwatch.StartNew();
        string current = "create-window"; int harnessErrors = 0; IntPtr hwnd = IntPtr.Zero; string hwndText = null; Form f = null;
        uint pid = (uint)System.Diagnostics.Process.GetCurrentProcess().Id; double dpi = 0;
        Color[] q = new Color[] { Color.FromArgb(220, 30, 30), Color.FromArgb(30, 200, 40), Color.FromArgb(40, 60, 230), Color.FromArgb(240, 220, 20) };
        Size[] sizes = new Size[] { new Size(640, 400), new Size(800, 500) };
        try {
            System.Diagnostics.Stopwatch sw = System.Diagnostics.Stopwatch.StartNew();
            f = new Form(); f.Text = "EightMax capture self-test " + pid; f.ClientSize = sizes[0]; f.StartPosition = FormStartPosition.Manual; f.Location = new Point(60, 60); f.ShowInTaskbar = true;
            f.Paint += delegate(object s, PaintEventArgs e) { Form self = (Form)s; int w = self.ClientSize.Width / 2, h = self.ClientSize.Height / 2; for (int i = 0; i < 4; i++) using (SolidBrush b = new SolidBrush(q[i])) e.Graphics.FillRectangle(b, (i % 2) * w, (i / 2) * h, w, h); };
            f.Show(); Pump(100);
            // 0.29 (found on a real Windows runner): when the tool is started with a hidden window style (STARTUPINFO wShowWindow =
            // SW_HIDE, as PowerShell -WindowStyle Hidden does), Windows applies it to the process's FIRST ShowWindow call, so the test
            // window stayed invisible and every capture reported "target-lost: not visible". A second, explicit call is honoured.
            try { ShowWindow(f.Handle, 5 /*SW_SHOW*/); } catch (Exception) { /* not Windows (test double runs) */ } f.Activate(); Pump(400);
            hwnd = f.Handle; hwndText = "0x" + hwnd.ToInt64().ToString("x"); // captured once, while the form is alive
            Record("create-window", hwnd != IntPtr.Zero && f.Visible, "hwnd=" + hwndText + " client=" + f.ClientSize.Width + "x" + f.ClientSize.Height + " visible=" + f.Visible, sw.Elapsed.TotalMilliseconds);
            string title = f.Text;
            for (int round = 0; round < 2; round++) {
                current = round == 0 ? "capture-original" : "capture-resized"; sw.Restart();
                if (round == 1) { f.ClientSize = sizes[1]; f.Invalidate(); Pump(400); }
                CaptureService.Target t = new CaptureService.Target { Kind = "window", Hwnd = hwndText, Pid = (int)pid, Title = title };
                string reply = CaptureService.GrabJson(t); string name = Path.Combine(dir, "selftest-" + round + ".png");
                if (Field(reply, "ok") != "True") { Record(current, false, Field(reply, "code") + ": " + Field(reply, "reason"), sw.Elapsed.TotalMilliseconds); continue; }
                File.WriteAllBytes(name, Convert.FromBase64String(Field(reply, "png")));
                int w = int.Parse(Field(reply, "width")), h = int.Parse(Field(reply, "height")); double.TryParse(Field(reply, "dpiScale"), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out dpi);
                bool sizeOk = w == f.ClientSize.Width && h == f.ClientSize.Height;
                Record(current, sizeOk, "saved " + name + " " + w + "x" + h + " method=" + Field(reply, "method") + " dpiScale=" + Field(reply, "dpiScale") + " expected=" + f.ClientSize.Width + "x" + f.ClientSize.Height, sw.Elapsed.TotalMilliseconds);
                current = round == 0 ? "verify-original-pixels" : "verify-resized-pixels"; sw.Restart(); string detail;
                int bad = CheckQuadrants(name, q, out detail); Record(current, bad == 0, detail, sw.Elapsed.TotalMilliseconds);
            }
            current = "minimize"; sw.Restart();
            f.WindowState = FormWindowState.Minimized; Pump(300);
            string minReply = CaptureService.GrabJson(new CaptureService.Target { Kind = "window", Hwnd = hwndText, Pid = (int)pid, Title = title });
            Record("detect-minimized", IsCode(minReply, "target-minimized"), "reply code=" + Field(minReply, "code"), sw.Elapsed.TotalMilliseconds);
            current = "restore"; sw.Restart();
            f.WindowState = FormWindowState.Normal; Pump(400);
            string back = CaptureService.GrabJson(new CaptureService.Target { Kind = "window", Hwnd = hwndText, Pid = (int)pid, Title = title });
            Record("capture-after-restore", Field(back, "ok") == "True", Field(back, "ok") == "True" ? Field(back, "width") + "x" + Field(back, "height") : Field(back, "code") + ": " + Field(back, "reason"), sw.Elapsed.TotalMilliseconds);
            current = "close"; sw.Restart();
            f.Close(); f.Dispose(); f = null; Pump(250); // after this point the Form object is never touched again
            current = "detect-closed"; sw.Restart();
            string lost = CaptureService.GrabJson(new CaptureService.Target { Kind = "window", Hwnd = hwndText, Pid = (int)pid });
            Record("detect-closed", IsCode(lost, "target-lost"), "original handle " + hwndText + " IsWindow=" + CaptureService.WindowExists(hwndText) + " reply code=" + Field(lost, "code"), sw.Elapsed.TotalMilliseconds);
        } catch (Exception e) {
            harnessErrors++; Record(current, false, "harness exception " + e.GetType().Name + ": " + Short(e.Message), 0);
        } finally {
            try { if (f != null && !f.IsDisposed) { f.Close(); f.Dispose(); } } catch (Exception e) { Record("cleanup", false, e.GetType().Name + ": " + Short(e.Message), 0); }
        }
        int failures = 0; foreach (Stage s in stages) if (s.Status != "pass") failures++;
        string[] required = { "create-window", "capture-original", "verify-original-pixels", "capture-resized", "verify-resized-pixels", "detect-minimized", "capture-after-restore", "detect-closed" };
        List<string> missing = new List<string>(); foreach (string r in required) { bool seen = false; foreach (Stage s in stages) if (s.Name == r) seen = true; if (!seen) missing.Add(r); }
        StringBuilder j = new StringBuilder("{\"format\":\"eightmax-capture-selftest\",\"version\":2,\"toolVersion\":" + Js(ToolVersion) + ",\"pid\":" + pid + ",\"dpiScale\":" + dpi.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture) + ",\"stages\":[");
        for (int i = 0; i < stages.Count; i++) { Stage s = stages[i]; if (i > 0) j.Append(','); j.Append("{\"stage\":" + Js(s.Name) + ",\"status\":" + Js(s.Status) + ",\"detail\":" + Js(s.Detail) + ",\"ms\":" + s.Ms.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture) + "}"); }
        j.Append("],\"missingStages\":[" + string.Join(",", missing.ConvertAll(Js).ToArray()) + "],\"failures\":" + failures + ",\"harnessErrors\":" + harnessErrors + ",\"passed\":" + (failures == 0 && missing.Count == 0 ? "true" : "false") + ",\"durationMs\":" + total.ElapsedMilliseconds + "}");
        try { File.WriteAllText(Path.Combine(dir, "selftest-result.json"), j.ToString(), new UTF8Encoding(false)); } catch (Exception e) { Console.WriteLine("could not write selftest-result.json: " + e.Message); }
        if (missing.Count > 0) Console.WriteLine("MISSING STAGES: " + string.Join(", ", missing.ToArray()));
        Console.WriteLine(failures == 0 && missing.Count == 0 ? "SELFTEST PASS" : "SELFTEST FAIL (" + (failures + missing.Count) + ")");
        return harnessErrors > 0 ? 4 : failures == 0 && missing.Count == 0 ? 0 : 1;
    }
}
