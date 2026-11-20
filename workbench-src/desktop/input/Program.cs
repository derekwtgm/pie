// EightMax Test Workbench 0.35.0 - EightMaxInput.exe entry point.
//   EightMaxInput.exe --version
//   EightMaxInput.exe [--parent-pid N] [--hotkey Ctrl+Alt+F12] [--backend win32|virtual --virtual-desktop FILE]   (token in EIGHTMAX_INPUT_TOKEN)
//   EightMaxInput.exe --selftest [--out FILE]   real SendInput into the driver's OWN test form (moves the visible cursor)
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace EightMax.Input {
public static class Program {
    public static string DpiAwareness = "unaware";
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
    [DllImport("shcore.dll")] static extern int SetProcessDpiAwareness(int v);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint ms);
    [DllImport("user32.dll")] static extern IntPtr GetThreadDpiAwarenessContext();
    [DllImport("user32.dll")] static extern int GetAwarenessFromDpiAwarenessContext(IntPtr c);
    [DllImport("user32.dll")] static extern bool AreDpiAwarenessContextsEqual(IntPtr a, IntPtr b);
    /// <summary>The executable's manifest asks for PerMonitorV2; the calls below only matter if it was ignored. Reports what is in effect.</summary>
    static void MakeDpiAware() {
        if (Current() == "unaware") { try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (Exception) { } }
        if (Current() == "unaware") { try { SetProcessDpiAwareness(2); } catch (Exception) { } }
        if (Current() == "unaware") { try { SetProcessDPIAware(); } catch (Exception) { } }
        DpiAwareness = Current();
    }
    static string Current() {
        try { IntPtr c = GetThreadDpiAwarenessContext(); if (AreDpiAwarenessContextsEqual(c, new IntPtr(-4))) return "per-monitor-v2"; int a = GetAwarenessFromDpiAwarenessContext(c); return a == 2 ? "per-monitor" : a == 1 ? "system" : "unaware"; }
        catch (Exception) { return "unknown (Windows older than 10 1607)"; }
    }
    [STAThread] public static int Main(string[] args) {
        string backend = "win32", desk = null, hotkey = "Ctrl+Alt+F12", outFile = null; int parent = 0; bool self = false;
        for (int i = 0; i < args.Length; i++) {
            string a = args[i]; Func<string> next = delegate { if (i + 1 >= args.Length) throw new ArgumentException(a + " needs a value"); return args[++i]; };
            if (a == "--version") { Console.WriteLine("EightMaxInput " + Driver.Version + " (EightMax Test Workbench input driver; SendInput, x64)"); return 0; }
            else if (a == "--backend") backend = next(); else if (a == "--virtual-desktop") desk = next(); else if (a == "--hotkey") hotkey = next();
            else if (a == "--parent-pid") parent = Int32.Parse(next()); else if (a == "--selftest") self = true; else if (a == "--out") outFile = next();
            else { Console.Error.WriteLine("Unknown argument " + a); return 2; }
        }
        bool win = backend == "win32"; if (win) { MakeDpiAware(); try { timeBeginPeriod(1); } catch (Exception) { } }
        if (self) return SelfTest.Run(hotkey, outFile);
        string token = Environment.GetEnvironmentVariable("EIGHTMAX_INPUT_TOKEN");
        if (token == null || token.Length < 32) { Console.Error.WriteLine("EightMaxInput is started by the EightMax desktop host or tools; no session token was supplied."); return 3; }
        Environment.SetEnvironmentVariable("EIGHTMAX_INPUT_TOKEN", null);
        IPlatform os; if (win) os = new Win32Platform(); else if (backend == "virtual" && desk != null) os = VirtualPlatform.Load(desk); else { Console.Error.WriteLine("Unknown backend"); return 2; }
        TextWriter stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = false };
        Driver d = new Driver(os, token, stdout); if (!win) { d.HotkeySpec = hotkey; d.OverrideGraceMs = 0; }
        if (win) SafetyWindow.Start(d, hotkey);
        // Parent watchdog: when the desktop host (or tool) that started the driver is gone, release everything and exit.
        if (parent > 0) { Thread w = new Thread(delegate() { while (true) { try { using (Process p = Process.GetProcessById(parent)) { } } catch (Exception) { break; } Thread.Sleep(500); } d.ReleaseAll(); Environment.Exit(0); }) { IsBackground = true, Name = "parent-watchdog" }; w.Start(); }
        d.Run(new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false)));
        d.ReleaseAll(); return 0;
    }
}

/// <summary>--selftest: drives the driver through its own protocol against a test form in this process (real SendInput, real cursor).</summary>
public static class SelfTest {
    sealed class Lines : TextWriter {
        public readonly List<string> All = new List<string>(); readonly StringBuilder cur = new StringBuilder(); readonly AutoResetEvent signal = new AutoResetEvent(false);
        public override Encoding Encoding { get { return Encoding.UTF8; } }
        public override void Write(char c) { lock (All) { if (c == '\n') { All.Add(cur.ToString()); cur.Length = 0; signal.Set(); } else cur.Append(c); } }
        public string WaitFor(long id, int ms) { string key = "\"id\":" + id + ","; Stopwatch sw = Stopwatch.StartNew(); while (sw.ElapsedMilliseconds < ms) { lock (All) foreach (string l in All) if (l.Contains(key)) return l; signal.WaitOne(50); } return null; }
    }
    sealed class TestForm : Form {
        public Button Btn = new Button(); public TextBox Box = new TextBox(); public int Clicks; public List<Point> Downs = new List<Point>();
        public TestForm() { Text = "EightMax input self-test"; FormBorderStyle = FormBorderStyle.FixedSingle; StartPosition = FormStartPosition.Manual; Location = new Point(80, 80); ClientSize = new Size(560, 320); AutoScaleMode = AutoScaleMode.None; TopMost = true;
            Btn.Text = "Fold"; Btn.Bounds = new Rectangle(380, 220, 140, 60); Btn.Click += delegate { Clicks++; }; Btn.MouseDown += delegate(object s, MouseEventArgs e) { Downs.Add(e.Location); };
            Box.Bounds = new Rectangle(40, 230, 200, 40); Box.Font = new Font("Segoe UI", 16f, GraphicsUnit.Pixel); Controls.Add(Btn); Controls.Add(Box); }
    }
    static Dictionary<string, object> Check(string name, bool ok, string detail) { Dictionary<string, object> d = new Dictionary<string, object>(); d["name"] = name; d["ok"] = ok; d["detail"] = detail; return d; }
    public static int Run(string hotkey, string outFile) {
        JavaScriptSerializer js = new JavaScriptSerializer { MaxJsonLength = 64 * 1024 * 1024 }; List<object> checks = new List<object>(); TestForm f = null; Exception fatal = null;
        Thread ui = new Thread(delegate() { f = new TestForm(); Application.Run(f); }); ui.SetApartmentState(ApartmentState.STA); ui.IsBackground = true; ui.Start();
        for (int i = 0; i < 100 && (f == null || !f.IsHandleCreated); i++) Thread.Sleep(50); Thread.Sleep(400);
        Lines outp = new Lines(); string token = Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N"); Win32Platform os = new Win32Platform(); Driver d = new Driver(os, token, outp);
        SafetyWindow.Start(d, hotkey);
        // The driver reads requests from this pipe-like reader.
        BlockingReader input = new BlockingReader(); Thread drv = new Thread(delegate() { d.Run(input); }) { IsBackground = true }; drv.Start();
        long seq = 0; Func<Dictionary<string, object>, int, Dictionary<string, object>> call = delegate(Dictionary<string, object> m, int ms) { long id = ++seq; m["id"] = id; input.Push(js.Serialize(m)); string l = outp.WaitFor(id, ms); return l == null ? null : (Dictionary<string, object>)js.DeserializeObject(l); };
        Func<string, Dictionary<string, object>> cmd = delegate(string c) { Dictionary<string, object> m = new Dictionary<string, object>(); m["cmd"] = c; return m; };
        try {
            long hwnd = 0; f.Invoke((Action)delegate { hwnd = f.Handle.ToInt64(); f.Activate(); }); string hex = Json.Hex(hwnd);
            Dictionary<string, object> h = cmd("hello"); h["token"] = token; Dictionary<string, object> r = call(h, 3000); checks.Add(Check("authenticated hello", r != null && (bool)r["ok"], r == null ? "no reply" : ""));
            call(cmd("arm"), 2000); Dictionary<string, object> bad = cmd("move"); bad["hwnd"] = hex; bad["to"] = P(10, 10); r = call(bad, 3000); checks.Add(Check("input refused for an unregistered window", r != null && !(bool)r["ok"] && (string)r["code"] == "target-not-registered", r == null ? "no reply" : (string)r["code"]));
            Dictionary<string, object> reg = cmd("register-target"); reg["hwnd"] = hex; Dictionary<string, object> auth = new Dictionary<string, object>(); auth["format"] = "eightmax-simulator-authorization"; auth["version"] = 1; auth["operatorOwnsSimulator"] = true; auth["testEnvironmentOnly"] = true; auth["noRealMoney"] = true;
            auth["expiresAtUnixMs"] = (DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds + 3600e3; Dictionary<string, object> exe = new Dictionary<string, object>(); string me = Process.GetCurrentProcess().MainModule.FileName; exe["fileName"] = Path.GetFileName(me); exe["sha256"] = os.ExeSha256(Process.GetCurrentProcess().Id); auth["executable"] = exe; reg["authorization"] = auth;
            r = call(reg, 5000); checks.Add(Check("register own test window with an executable-bound authorization", r != null && (bool)r["ok"], r == null ? "no reply" : js.Serialize(r).Substring(0, Math.Min(300, js.Serialize(r).Length))));
            r = call(cmd("arm"), 2000); WinInfo w = os.Window(hwnd);
            Rectangle bb = Rectangle.Empty, tb = Rectangle.Empty; f.Invoke((Action)delegate { bb = f.RectangleToScreen(f.Btn.Bounds); tb = f.RectangleToScreen(f.Box.Bounds); });
            // 1. smooth movement + click, sampled independently
            call(cmd("monitor-start"), 2000); os.MoveAbsolute(w.Client.X + 20, w.Client.Y + 20); Thread.Sleep(60); Dictionary<string, object> mc = cmd("move-click"); mc["hwnd"] = hex; mc["to"] = P(bb.X + bb.Width / 2, bb.Y + bb.Height / 2); mc["region"] = Json.Box(new Rect(bb.X, bb.Y, bb.Width, bb.Height)); mc["expectClient"] = Json.Box(w.Client);
            r = call(mc, 10000); Dictionary<string, object> mon = call(cmd("monitor-stop"), 3000); Thread.Sleep(200);
            int clicks = 0; f.Invoke((Action)delegate { clicks = f.Clicks; });
            checks.Add(Check("move-click lands one click on the button", r != null && (bool)r["ok"] && clicks == 1, "clicks=" + clicks + " " + (r == null ? "no reply" : (bool)r["ok"] ? "planned " + r["plannedMs"] + " ms, actual " + r["actualMs"] + " ms, steps " + r["steps"] + ", final error " + r["finalError"] : (string)r["error"])));
            int maxJump = 0, n = 0; System.Collections.IList ss = mon == null ? (System.Collections.IList)new object[0] : (System.Collections.IList)mon["samples"]; int px = int.MinValue, py = 0;
            foreach (object o in ss) { System.Collections.IList s = (System.Collections.IList)o; int x = Convert.ToInt32(s[1]), y = Convert.ToInt32(s[2]); if (px != int.MinValue) maxJump = Math.Max(maxJump, Math.Max(Math.Abs(x - px), Math.Abs(y - py))); px = x; py = y; n++; }
            checks.Add(Check("independently sampled path is continuous (no jump larger than max speed x update interval)", n > 20 && maxJump <= 34, n + " samples, largest step " + maxJump + " px (limit 1600 px/s x 16 ms + margin = 34 px)"));
            // 2. wager entry and read-back
            Dictionary<string, object> et = cmd("enter-text"); et["hwnd"] = hex; et["to"] = P(tb.X + tb.Width / 2, tb.Y + tb.Height / 2); et["region"] = Json.Box(new Rect(tb.X, tb.Y, tb.Width, tb.Height)); et["text"] = "1250"; et["expectClient"] = Json.Box(w.Client);
            f.Invoke((Action)delegate { f.Box.Text = "99"; }); r = call(et, 15000); string boxText = ""; f.Invoke((Action)delegate { boxText = f.Box.Text; });
            checks.Add(Check("enter-text clears '99', types 1250 key by key and reads it back", r != null && (bool)r["ok"] && boxText == "1250", "field=" + boxText + " " + (r == null ? "" : (bool)r["ok"] ? "verified" : (string)r["error"])));
            // 3. layout guard
            Dictionary<string, object> lg = cmd("move"); lg["hwnd"] = hex; lg["to"] = P(bb.X + 5, bb.Y + 5); Rect moved = w.Client; moved.X += 7; lg["expectClient"] = Json.Box(moved); r = call(lg, 5000);
            checks.Add(Check("stale coordinates refused after the window moved (layout-changed)", r != null && !(bool)r["ok"] && (string)r["code"] == "layout-changed", r == null ? "no reply" : (string)r["code"]));
            // 4. cancellation mid-movement: nothing moves afterwards
            os.MoveAbsolute(w.Client.X + 10, w.Client.Y + 10); Thread.Sleep(50); Dictionary<string, object> slow = cmd("move"); slow["hwnd"] = hex; slow["to"] = P(w.Client.X + w.Client.W - 20, w.Client.Y + w.Client.H - 20); Dictionary<string, object> mo = new Dictionary<string, object>(); mo["maxSpeed"] = 200.0; mo["maxAccel"] = 2000.0; slow["motion"] = mo;
            long sid = seq + 1; slow["id"] = sid; seq = sid; input.Push(js.Serialize(slow)); Thread.Sleep(350); Dictionary<string, object> c = cmd("cancel"); c["op"] = sid; call(c, 2000); string sl = outp.WaitFor(sid, 5000);
            int ax, ay; os.GetCursor(out ax, out ay); Thread.Sleep(300); int bx2, by2; os.GetCursor(out bx2, out by2);
            checks.Add(Check("cancel stops a movement and the cursor stays still afterwards", sl != null && sl.Contains("\"cancelled\"") && ax == bx2 && ay == by2, (sl ?? "no reply").Substring(0, Math.Min(160, (sl ?? "no reply").Length)) + " drift=" + (Math.Abs(bx2 - ax) + Math.Abs(by2 - ay))));
            // 5. emergency hotkey (pressed through SendInput here; a person presses it on the keyboard)
            uint[] hk = SafetyWindow.ParseHotkey(hotkey); List<ushort> mods = new List<ushort>(); if ((hk[0] & 2) != 0) mods.Add(0x11); if ((hk[0] & 1) != 0) mods.Add(0x12); if ((hk[0] & 4) != 0) mods.Add(0x10);
            foreach (ushort m in mods) os.Key(m, true); os.Key((ushort)hk[1], true); os.Key((ushort)hk[1], false); for (int i = mods.Count - 1; i >= 0; i--) os.Key(mods[i], false); Thread.Sleep(400);
            Dictionary<string, object> st = call(cmd("status"), 2000); bool latched = st != null && st["estop"] != null; Dictionary<string, object> after = cmd("move"); after["hwnd"] = hex; after["to"] = P(bb.X + 5, bb.Y + 5); r = call(after, 3000);
            checks.Add(Check("emergency hotkey " + hotkey + " latches a stop and further input is refused", d.HotkeyRegistered && latched && r != null && (string)r["code"] == "emergency-stop", "registered=" + d.HotkeyRegistered + " latched=" + latched + " next=" + (r == null ? "none" : (string)r["code"])));
            call(cmd("reset-estop"), 2000); call(cmd("arm"), 2000);
            // 6. nothing held
            Thread.Sleep(100); bool held = os.IsKeyDown(1) || os.IsKeyDown(0x11) || os.IsKeyDown(0x12) || os.IsKeyDown(0x10);
            checks.Add(Check("no mouse button or modifier key left pressed", !held, held ? "something is still down" : "all released"));
            checks.Add(Check("raw-input manual override available", d.RawInputActive, d.SafetyNote));
            call(cmd("shutdown"), 2000);
        } catch (Exception e) { fatal = e; }
        try { f.Invoke((Action)delegate { f.Close(); }); } catch (Exception) { }
        int passed = 0; foreach (Dictionary<string, object> k in checks) if ((bool)k["ok"]) passed++;
        Dictionary<string, object> res = new Dictionary<string, object>(); res["format"] = "eightmax-input-selftest"; res["version"] = 1; res["driver"] = Driver.Version; res["dpiAwareness"] = Program.DpiAwareness; res["checks"] = checks; res["passed"] = passed; res["total"] = checks.Count;
        res["fatal"] = fatal == null ? null : fatal.ToString(); res["ok"] = fatal == null && passed == checks.Count; res["virtualScreen"] = Json.Box(new Win32Platform().VirtualScreen());
        string text = js.Serialize(res); if (outFile != null) File.WriteAllText(outFile, text, new UTF8Encoding(false)); Console.WriteLine(text);
        return (bool)res["ok"] ? 0 : 1;
    }
    static Dictionary<string, object> P(int x, int y) { Dictionary<string, object> d = new Dictionary<string, object>(); d["x"] = x; d["y"] = y; return d; }
}
public sealed class BlockingReader : TextReader {
    readonly Queue<string> q = new Queue<string>(); bool closed;
    public void Push(string l) { lock (q) { q.Enqueue(l); Monitor.Pulse(q); } }
    public void CloseInput() { lock (q) { closed = true; Monitor.PulseAll(q); } }
    public override string ReadLine() { lock (q) { while (q.Count == 0 && !closed) Monitor.Wait(q); return q.Count > 0 ? q.Dequeue() : null; } }
}
}
