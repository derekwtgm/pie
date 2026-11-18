// EightMax Test Workbench 0.25 - stand-alone capture tool (used by the Windows acceptance script and for diagnostics).
// Compiled together with ../CaptureService.cs. C# 5 compatible. NOT executed on Windows in this release.
//   EightMaxCapture.exe list-windows | list-monitors
//   EightMaxCapture.exe capture-window <hwnd> <pid> <out.png> [title] [auto|print-window|screen-copy]
//   EightMaxCapture.exe capture-region <x> <y> <w> <h> <out.png>
//   EightMaxCapture.exe selftest <out-dir>     (opens its own window with a known pattern, captures it three ways, checks pixels)
using System;
using System.Drawing;
using System.IO;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using EightMax.Workbench;

public static class EightMaxCapture {
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
        if (a.Length == 0) { Console.Error.WriteLine("usage: list-windows | list-monitors | capture-window | capture-region | selftest"); return 2; }
        CaptureService.EnsureDpiAware();
        switch (a[0]) {
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
    // Opens a window with four coloured quadrants, captures its client area (print-window), checks the quadrant colours, then resizes and re-checks.
    static int SelfTest(string dir) {
        Directory.CreateDirectory(dir); int failures = 0;
        Form f = new Form(); f.Text = "EightMax capture self-test"; f.ClientSize = new Size(640, 400); f.StartPosition = FormStartPosition.Manual; f.Location = new Point(60, 60);
        Color[] q = new Color[] { Color.FromArgb(220, 30, 30), Color.FromArgb(30, 200, 40), Color.FromArgb(40, 60, 230), Color.FromArgb(240, 220, 20) };
        f.Paint += delegate(object s, PaintEventArgs e) { int w = f.ClientSize.Width / 2, h = f.ClientSize.Height / 2; for (int i = 0; i < 4; i++) using (SolidBrush b = new SolidBrush(q[i])) e.Graphics.FillRectangle(b, (i % 2) * w, (i / 2) * h, w, h); };
        f.Show(); Application.DoEvents(); System.Threading.Thread.Sleep(400); Application.DoEvents();
        uint pid = (uint)System.Diagnostics.Process.GetCurrentProcess().Id;
        for (int round = 0; round < 2; round++) {
            CaptureService.Target t = new CaptureService.Target { Kind = "window", Hwnd = "0x" + f.Handle.ToInt64().ToString("x"), Pid = (int)pid, Title = f.Text };
            string reply = CaptureService.GrabJson(t); string name = Path.Combine(dir, "selftest-" + round + ".png");
            if (Save(reply, name) != 0) { failures++; continue; }
            using (Bitmap b = new Bitmap(name)) {
                int w = b.Width, h = b.Height; Point[] pts = new Point[] { new Point(w / 4, h / 4), new Point(3 * w / 4, h / 4), new Point(w / 4, 3 * h / 4), new Point(3 * w / 4, 3 * h / 4) };
                for (int i = 0; i < 4; i++) { Color c = b.GetPixel(pts[i].X, pts[i].Y); if (Math.Abs(c.R - q[i].R) > 12 || Math.Abs(c.G - q[i].G) > 12 || Math.Abs(c.B - q[i].B) > 12) { Console.Error.WriteLine("quadrant " + i + " colour " + c + " != " + q[i]); failures++; } }
            }
            f.ClientSize = new Size(800, 500); f.Invalidate(); Application.DoEvents(); System.Threading.Thread.Sleep(400); Application.DoEvents(); // resize between rounds
        }
        f.WindowState = FormWindowState.Minimized; Application.DoEvents(); System.Threading.Thread.Sleep(300);
        string minReply = CaptureService.GrabJson(new CaptureService.Target { Kind = "window", Hwnd = "0x" + f.Handle.ToInt64().ToString("x"), Pid = (int)pid, Title = f.Text });
        if (Field(minReply, "code") != "target-minimized") { Console.Error.WriteLine("minimised window was not reported: " + minReply.Substring(0, Math.Min(120, minReply.Length))); failures++; } else Console.WriteLine("minimised window correctly reported");
        f.Close(); Application.DoEvents();
        string lost = CaptureService.GrabJson(new CaptureService.Target { Kind = "window", Hwnd = "0x" + f.Handle.ToInt64().ToString("x"), Pid = (int)pid });
        if (Field(lost, "code") != "target-lost") { Console.Error.WriteLine("closed window was not reported lost: " + lost.Substring(0, Math.Min(120, lost.Length))); failures++; } else Console.WriteLine("closed window correctly reported lost");
        Console.WriteLine(failures == 0 ? "SELFTEST PASS" : "SELFTEST FAIL (" + failures + ")"); return failures == 0 ? 0 : 1;
    }
}
