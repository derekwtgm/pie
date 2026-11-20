// EightMax Test Workbench 0.35.0 - EightMaxInput.exe, the Windows input driver.
//
// What it does: visible mouse and keyboard input into ONE kind of target - a window the operator registered and authorised
// (their own simulator or the bundled test table). Protocol: one JSON object per line on stdin/stdout, opened by
// {"cmd":"hello","token":...} with the token the parent put in EIGHTMAX_INPUT_TOKEN; nothing else is accepted before that.
// Input operations run one at a time on a worker thread (the desktop has one cursor); cancel / estop / status / release
// commands are handled immediately on the reader thread so they can interrupt a movement in progress.
//
// Safety: every operation names a registered target and is refused unless the window still has the same handle, process id,
// process start time and class, is not minimised, has the expected client rectangle, and the window under the point is the
// target itself. Movements re-check this while they run. The emergency hotkey (RegisterHotKey) and physical mouse/keyboard
// activity (Raw Input: injected input has no device handle) latch a stop; nothing resumes without an explicit command.
// Held buttons and keys are always released (finally blocks, emergency stop, shutdown, parent exit, stdin closing).
// Not here: hooks, process-memory access, hidden input, anti-detection, randomised "human" behaviour, launching programs.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

[assembly: System.Reflection.AssemblyTitle("EightMax Workbench input driver")]
[assembly: System.Reflection.AssemblyProduct("EightMax Test Workbench")]
[assembly: System.Reflection.AssemblyVersion("0.35.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("0.35.0.0")]
[assembly: System.Reflection.AssemblyInformationalVersion("0.35.0")]
namespace EightMax.Input {
public sealed class DriverError : Exception { public readonly string Code; public DriverError(string code, string message) : base(message) { Code = code; } }

public static class Json {
    public static readonly CultureInfo C = CultureInfo.InvariantCulture;
    public static Dictionary<string, object> Obj(object o) { Dictionary<string, object> d = o as Dictionary<string, object>; if (d == null) throw new DriverError("bad-request", "Expected a JSON object."); return d; }
    public static object Get(Dictionary<string, object> d, string k) { object v; return d != null && d.TryGetValue(k, out v) ? v : null; }
    public static double Num(Dictionary<string, object> d, string k, double def, double lo, double hi) {
        object v = Get(d, k); if (v == null) return def;
        if (!(v is int || v is long || v is decimal || v is double)) throw new DriverError("bad-request", k + " must be a number.");
        double x = Convert.ToDouble(v, C); if (Double.IsNaN(x) || x < lo || x > hi) throw new DriverError("bad-request", k + " must be between " + lo + " and " + hi + "."); return x;
    }
    public static int Int(Dictionary<string, object> d, string k, int def, int lo, int hi) { double x = Num(d, k, def, lo, hi); if (Math.Floor(x) != x) throw new DriverError("bad-request", k + " must be an integer."); return (int)x; }
    public static string Str(Dictionary<string, object> d, string k, int max) { string s = Get(d, k) as string; if (s == null || s.Length > max) throw new DriverError("bad-request", k + " must be text of at most " + max + " characters."); return s; }
    public static Rect Box(object o) { Dictionary<string, object> d = Obj(o); return new Rect(Int(d, "x", 0, -100000, 100000), Int(d, "y", 0, -100000, 100000), Int(d, "w", 0, 0, 100000), Int(d, "h", 0, 0, 100000)); }
    public static Dictionary<string, object> Box(Rect r) { Dictionary<string, object> d = new Dictionary<string, object>(); d["x"] = r.X; d["y"] = r.Y; d["w"] = r.W; d["h"] = r.H; return d; }
    public static long Handle(object o) {
        string s = o as string; if (s != null) { if (s.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) return Convert.ToInt64(s.Substring(2), 16); return Convert.ToInt64(s, C); }
        if (o is int || o is long) return Convert.ToInt64(o); throw new DriverError("bad-request", "Window handle must be text like 0x1A2B.");
    }
    public static string Hex(long h) { return "0x" + h.ToString("X", C); }
}

public sealed class Target {
    public long Hwnd; public int Pid; public long ProcessStart; public string ClassName = ""; public string Exe = ""; public string ExeSha256 = ""; public string Label = "";
    public DateTime Expires = DateTime.MaxValue;
}

public sealed class Op {
    public long Id; public string Cmd = ""; public Dictionary<string, object> Args; public long Enqueued; public volatile bool Cancelled; public string CancelReason = "";
}

public sealed class Driver {
    public const string Version = "0.35.0";
    readonly IPlatform os; readonly string token; readonly TextWriter output; readonly object outGate = new object();
    readonly JavaScriptSerializer js = new JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024, RecursionLimit = 32 };
    readonly Dictionary<long, Target> targets = new Dictionary<long, Target>();
    readonly Queue<Op> queue = new Queue<Op>(); readonly object qGate = new object(); const int MaxQueue = 8;
    volatile Op current; volatile bool authenticated, stopping;
    // Latched safety states. estop: emergency stop (hotkey or command); yielded: a person used the mouse/keyboard; manual: operator chose manual control.
    volatile string estop, yielded; volatile bool manual, armed; long armedAt;
    readonly HashSet<ushort> heldKeys = new HashSet<ushort>(); readonly bool[] heldButtons = new bool[2];
    int lastX = int.MinValue, lastY = int.MinValue; long lastClickAt; int lastClickX, lastClickY;
    public string HotkeySpec = "Ctrl+Alt+F12"; public volatile bool HotkeyRegistered; public volatile bool RawInputActive; public string SafetyNote = "";
    public int OverrideGraceMs = 1500, OverrideTolerancePx = 6;
    readonly Stats stats = new Stats();
    CursorMonitor monitor;
    sealed class Stats { public long Ops, Moves, Clicks, Keys, Chars, Refused, Cancelled, Errors, Corrections, MaxCorrection, DoubleClickGuards; }

    public Driver(IPlatform platform, string token, TextWriter output) { os = platform; this.token = token; this.output = output; }
    public IPlatform Platform { get { return os; } }

    /* ---------------- output ---------------- */
    public void Send(Dictionary<string, object> m) { string line; lock (js) line = js.Serialize(m); lock (outGate) { output.Write(line); output.Write('\n'); output.Flush(); } }
    Dictionary<string, object> Reply(long id, bool ok) { Dictionary<string, object> r = new Dictionary<string, object>(); r["id"] = id; r["ok"] = ok; return r; }
    void Fail(long id, string code, string message) { Dictionary<string, object> r = Reply(id, false); r["code"] = code; r["error"] = message; Send(r); }
    public void Event(string kind, string detail) { Dictionary<string, object> e = new Dictionary<string, object>(); e["event"] = kind; e["detail"] = detail; e["t"] = os.Ticks(); Send(e); }

    /* ---------------- safety latches (callable from any thread) ---------------- */
    public void EmergencyStop(string why) {
        if (estop == null) estop = why; Op c = current; if (c != null) { c.Cancelled = true; c.CancelReason = "emergency stop"; }
        lock (qGate) { while (queue.Count > 0) { Op q = queue.Dequeue(); Fail(q.Id, "emergency-stop", "Emergency stop: " + why); } }
        ReleaseAll(); armed = false; Event("estop", why);
    }
    public void PhysicalInput(string what) {
        if (!armed || yielded != null || estop != null) return; if (os.Ticks() - armedAt < OverrideGraceMs) return;
        yielded = what; Op c = current; if (c != null) { c.Cancelled = true; c.CancelReason = "manual override"; }
        lock (qGate) { while (queue.Count > 0) { Op q = queue.Dequeue(); Fail(q.Id, "manual-override", "You used the mouse or keyboard; automation yielded."); } }
        ReleaseAll(); Event("override", what);
    }
    public void ReleaseAll() {
        lock (heldKeys) {
            for (int b = 0; b < 2; b++) if (heldButtons[b]) { try { os.Button(b, false); } catch (Exception) { } heldButtons[b] = false; }
            foreach (ushort k in new List<ushort>(heldKeys)) { try { os.Key(k, false); } catch (Exception) { } }
            heldKeys.Clear();
            // Modifiers the driver might have pressed are released even when not recorded (e.g. after an exception between press and record).
            foreach (ushort m in new ushort[] { 0x10, 0x11, 0x12, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5 }) if (os.IsKeyDown(m) && WePressedModifiers) { try { os.Key(m, false); } catch (Exception) { } }
            WePressedModifiers = false;
        }
    }
    bool WePressedModifiers;
    void Down(int b) { lock (heldKeys) { heldButtons[b] = true; } os.Button(b, true); }
    void Up(int b) { try { os.Button(b, false); } finally { lock (heldKeys) heldButtons[b] = false; } }
    void KeyDown(ushort vk) { lock (heldKeys) { heldKeys.Add(vk); if (vk >= 0x10 && vk <= 0x12 || vk >= 0xA0 && vk <= 0xA5) WePressedModifiers = true; } os.Key(vk, true); }
    void KeyUp(ushort vk) { try { os.Key(vk, false); } finally { lock (heldKeys) heldKeys.Remove(vk); } }

    /* ---------------- reader ---------------- */
    public void Run(TextReader input) {
        Thread worker = new Thread(WorkLoop) { IsBackground = true, Name = "input-worker" }; worker.Start();
        try {
            string line;
            while (!stopping && (line = input.ReadLine()) != null) { if (line.Length == 0) continue; if (line.Length > 1000000) { Fail(0, "too-large", "Request line exceeds 1 MB."); continue; } Handle(line); }
        } finally { stopping = true; ReleaseAll(); lock (qGate) Monitor.PulseAll(qGate); if (monitor != null) monitor.Stop(); }
    }
    void Handle(string line) {
        Dictionary<string, object> m; long id = 0;
        try { lock (js) m = Json.Obj(js.DeserializeObject(line)); } catch (Exception) { Fail(0, "bad-json", "Request is not a JSON object."); return; }
        try {
            object idv = Json.Get(m, "id"); if (idv != null) id = Convert.ToInt64(idv, Json.C);
            string cmd = Json.Get(m, "cmd") as string ?? "";
            if (!authenticated) {
                if (cmd != "hello") { Fail(id, "not-authenticated", "Send hello with the session token first."); return; }
                string t = Json.Get(m, "token") as string; if (token == null || t == null || !SecureEquals(t, token)) { Fail(id, "bad-token", "Wrong session token."); stopping = true; return; }
                authenticated = true; Dictionary<string, object> r = Reply(id, true); r["driver"] = Version; r["platform"] = os.Name; r["capabilities"] = Capabilities(); Send(r); return;
            }
            switch (cmd) {
                case "health": case "status": Send(Status(id)); return;
                case "cancel": { long op = Convert.ToInt64(Json.Get(m, "op"), Json.C); bool hit = false; Op c = current; if (c != null && c.Id == op) { c.Cancelled = true; c.CancelReason = "cancelled"; hit = true; }
                    lock (qGate) { Queue<Op> keep = new Queue<Op>(); while (queue.Count > 0) { Op q = queue.Dequeue(); if (q.Id == op) { hit = true; Fail(q.Id, "cancelled", "Cancelled before it started."); } else keep.Enqueue(q); } while (keep.Count > 0) queue.Enqueue(keep.Dequeue()); }
                    Dictionary<string, object> r = Reply(id, true); r["found"] = hit; Send(r); return; }
                case "cancel-all": { Op c = current; if (c != null) { c.Cancelled = true; c.CancelReason = "cancelled"; } int n = 0; lock (qGate) { while (queue.Count > 0) { n++; Fail(queue.Dequeue().Id, "cancelled", "Cancelled before it started."); } } Dictionary<string, object> r = Reply(id, true); r["dropped"] = n; Send(r); return; }
                case "estop": EmergencyStop(Json.Get(m, "reason") as string ?? "operator"); Send(Status(id)); return;
                case "reset-estop": if (current != null) { Fail(id, "busy", "Wait for the cancelled operation to finish."); return; } estop = null; Send(Status(id)); return;
                case "arm": if (estop != null) { Fail(id, "emergency-stop", "Reset the emergency stop first."); return; } yielded = null; armed = true; armedAt = os.Ticks(); RememberCursor(); Send(Status(id)); return;
                case "disarm": armed = false; { Op c = current; if (c != null) { c.Cancelled = true; c.CancelReason = "automation disabled"; } } Send(Status(id)); return;
                case "resume": if (estop != null) { Fail(id, "emergency-stop", "Reset the emergency stop first."); return; } yielded = null; armedAt = os.Ticks(); RememberCursor(); Send(Status(id)); return;
                case "manual-mode": manual = Json.Get(m, "on") is bool && (bool)Json.Get(m, "on"); if (manual) { Op c = current; if (c != null) { c.Cancelled = true; c.CancelReason = "manual control mode"; } ReleaseAll(); } Send(Status(id)); return;
                case "release-all": ReleaseAll(); Send(Status(id)); return;
                case "monitor-start": { if (monitor != null) monitor.Stop(); monitor = new CursorMonitor(os, Json.Int(m, "intervalMs", 2, 1, 50), Json.Int(m, "maxSamples", 200000, 100, 2000000)); monitor.Start(); Send(Reply(id, true)); return; }
                case "monitor-stop": { Dictionary<string, object> r = Reply(id, true); if (monitor != null) { monitor.Stop(); r["samples"] = monitor.Samples(); r["buttonDownSamples"] = monitor.ButtonDown; monitor = null; } else r["samples"] = new object[0]; Send(r); return; }
                case "shutdown": stopping = true; ReleaseAll(); Send(Reply(id, true)); return;
                case "virtual-user-move": { VirtualPlatform v = os as VirtualPlatform; if (v == null) { Fail(id, "unsupported", "Only the virtual test desktop accepts simulated user input."); return; } v.UserMove(Json.Int(m, "x", 0, -100000, 100000), Json.Int(m, "y", 0, -100000, 100000)); PhysicalInput("simulated person moved the mouse"); Send(Reply(id, true)); return; }
                case "virtual-hotkey": { if (!(os is VirtualPlatform)) { Fail(id, "unsupported", "Only the virtual test desktop simulates the hotkey."); return; } EmergencyStop("hotkey " + HotkeySpec + " (simulated)"); Send(Reply(id, true)); return; }
                case "virtual-events": { VirtualPlatform v = os as VirtualPlatform; if (v == null) { Fail(id, "unsupported", "virtual only"); return; } Dictionary<string, object> r = Reply(id, true); lock (v) r["events"] = v.Events.ToArray(); Send(r); return; }
            }
            Op o = new Op { Id = id, Cmd = cmd, Args = m, Enqueued = os.Ticks() };
            if (!IsOperation(cmd)) { Fail(id, "unknown-command", "Unknown command " + cmd + "."); return; }
            lock (qGate) { if (queue.Count >= MaxQueue) { stats.Refused++; Fail(id, "queue-full", "The input queue holds " + MaxQueue + " operations; wait for them to finish."); return; } queue.Enqueue(o); Monitor.Pulse(qGate); }
        } catch (DriverError e) { Fail(id, e.Code, e.Message); } catch (Exception e) { Fail(id, "internal-error", e.GetType().Name + ": " + e.Message); }
    }
    static bool SecureEquals(string a, string b) { if (a.Length != b.Length) return false; int d = 0; for (int i = 0; i < a.Length; i++) d |= a[i] ^ b[i]; return d == 0; }
    static readonly string[] Operations = { "cursor", "monitors", "list-windows", "window-info", "exe-identity", "register-target", "unregister-target", "focus", "move", "move-click", "click", "double-click", "mouse-down", "mouse-up", "key", "type", "clear-field", "read-text", "enter-text", "uia-controls", "wait" };
    static bool IsOperation(string c) { return Array.IndexOf(Operations, c) >= 0; }

    Dictionary<string, object> Capabilities() {
        Dictionary<string, object> c = new Dictionary<string, object>();
        c["operations"] = Operations; c["sendInput"] = os.Name == "win32"; c["virtual"] = os.Name == "virtual"; c["uiAutomation"] = Uia.Available; c["rawInputOverride"] = RawInputActive;
        c["hotkey"] = HotkeySpec; c["hotkeyRegistered"] = HotkeyRegistered; c["maxQueue"] = MaxQueue; c["dpiAwareness"] = Program.DpiAwareness; c["note"] = SafetyNote; return c;
    }
    Dictionary<string, object> Status(long id) {
        Dictionary<string, object> r = Reply(id, true); r["driver"] = Version; r["platform"] = os.Name; r["estop"] = estop; r["yielded"] = yielded; r["manual"] = manual; r["armed"] = armed;
        Op c = current; r["busy"] = c != null; r["currentOp"] = c == null ? null : (object)c.Id; lock (qGate) r["queued"] = queue.Count;
        lock (heldKeys) { r["heldButtons"] = heldButtons[0] || heldButtons[1]; r["heldKeys"] = heldKeys.Count; }
        r["targets"] = targets.Count; r["capabilities"] = Capabilities();
        Dictionary<string, object> s = new Dictionary<string, object>(); s["ops"] = stats.Ops; s["moves"] = stats.Moves; s["clicks"] = stats.Clicks; s["keys"] = stats.Keys; s["chars"] = stats.Chars; s["refused"] = stats.Refused; s["cancelled"] = stats.Cancelled; s["errors"] = stats.Errors; s["corrections"] = stats.Corrections; s["maxCorrectionPx"] = stats.MaxCorrection; s["doubleClickGuards"] = stats.DoubleClickGuards; r["stats"] = s;
        return r;
    }

    /* ---------------- worker ---------------- */
    void WorkLoop() {
        while (!stopping) {
            Op o; lock (qGate) { while (queue.Count == 0 && !stopping) Monitor.Wait(qGate, 500); if (stopping) return; o = queue.Dequeue(); current = o; }
            try {
                int maxWait = Json.Int(o.Args, "queueTimeoutMs", 10000, 0, 600000);
                if (os.Ticks() - o.Enqueued > maxWait) throw new DriverError("expired", "Waited " + (os.Ticks() - o.Enqueued) + " ms in the queue (limit " + maxWait + " ms); not executed.");
                Dictionary<string, object> r = Execute(o); stats.Ops++; Send(r);
            } catch (DriverError e) { if (e.Code == "cancelled" || e.Code == "emergency-stop" || e.Code == "manual-override") stats.Cancelled++; else stats.Refused++; Fail(o.Id, e.Code, e.Message); }
            catch (Exception e) { stats.Errors++; Fail(o.Id, "internal-error", e.GetType().Name + ": " + e.Message); }
            finally { ReleaseHeldAfterOp(); current = null; }
        }
    }
    void ReleaseHeldAfterOp() { lock (heldKeys) { if (!(heldButtons[0] || heldButtons[1] || heldKeys.Count > 0)) return; } if (current != null && (current.Cmd == "mouse-down")) return; ReleaseAll(); }

    void Gate(Op o) {
        if (estop != null) throw new DriverError("emergency-stop", "Emergency stop is latched (" + estop + "); reset it explicitly.");
        if (yielded != null) throw new DriverError("manual-override", "Automation yielded to manual input (" + yielded + "); resume explicitly.");
        if (manual) throw new DriverError("manual-mode", "Manual control mode is on.");
        if (o.Cancelled) throw new DriverError(o.CancelReason == "emergency stop" ? "emergency-stop" : o.CancelReason == "manual override" ? "manual-override" : "cancelled", "Operation " + o.CancelReason + ".");
    }
    bool InputOp(string cmd) { return cmd == "focus" || cmd == "move" || cmd == "move-click" || cmd == "click" || cmd == "double-click" || cmd == "mouse-down" || cmd == "mouse-up" || cmd == "key" || cmd == "type" || cmd == "clear-field" || cmd == "enter-text"; }

    Dictionary<string, object> Execute(Op o) {
        Dictionary<string, object> a = o.Args, r = Reply(o.Id, true);
        if (InputOp(o.Cmd)) { Gate(o); if (!armed) throw new DriverError("not-armed", "Automation is not enabled (send arm after the operator enables it)."); CheckCursorOwnership(); }
        switch (o.Cmd) {
            case "cursor": { int x, y; os.GetCursor(out x, out y); r["x"] = x; r["y"] = y; r["virtualScreen"] = Json.Box(os.VirtualScreen()); return r; }
            case "monitors": { List<object> l = new List<object>(); foreach (MonitorInfo m in os.Monitors()) { Dictionary<string, object> d = new Dictionary<string, object>(); d["id"] = m.Id; d["name"] = m.Name; d["bounds"] = Json.Box(m.Bounds); d["work"] = Json.Box(m.Work); d["dpiScale"] = m.DpiScale; d["primary"] = m.Primary; l.Add(d); } r["monitors"] = l; r["virtualScreen"] = Json.Box(os.VirtualScreen()); return r; }
            case "list-windows": { List<object> l = new List<object>(); foreach (WinInfo w in os.TopWindows()) l.Add(Describe(w)); r["windows"] = l; return r; }
            case "window-info": { WinInfo w = os.Window(Json.Handle(Json.Get(a, "hwnd"))); if (w == null) throw new DriverError("window-gone", "That window no longer exists."); r["window"] = Describe(w); return r; }
            case "exe-identity": { WinInfo w = os.Window(Json.Handle(Json.Get(a, "hwnd"))); if (w == null) throw new DriverError("window-gone", "That window no longer exists."); r["window"] = Describe(w); r["exeSha256"] = os.ExeSha256(w.Pid); return r; }
            case "register-target": return Register(a, r);
            case "unregister-target": { long h = Json.Handle(Json.Get(a, "hwnd")); lock (targets) targets.Remove(h); return r; }
            case "focus": { Target t = Check(a); Focus(t, true); r["foreground"] = Json.Hex(os.Foreground()); return r; }
            case "move": { Target t = Check(a); MoveTo(o, t, a, r); return r; }
            case "move-click": { Target t = Check(a); MoveTo(o, t, a, r); ClickAt(o, t, a, r, 1); return r; }
            case "click": { Target t = Check(a); ClickAt(o, t, a, r, 1); return r; }
            case "double-click": { Target t = Check(a); if (!(Json.Get(a, "authorized") is bool) || !(bool)Json.Get(a, "authorized")) throw new DriverError("double-click-not-authorized", "Double-click only when the control's profile says it needs one (authorized: true)."); ClickAt(o, t, a, r, 2); return r; }
            case "mouse-down": { Target t = Check(a); int x, y; os.GetCursor(out x, out y); HitCheck(t, a, x, y); Down(Btn(a)); NoteInput(); stats.Clicks++; lastClickAt = os.Ticks(); lastClickX = x; lastClickY = y; return r; }
            case "mouse-up": { Up(Btn(a)); NoteInput(); return r; }
            case "key": { Target t = Check(a); RequireForeground(t); PressKey(o, t, a); return r; }
            case "type": { Target t = Check(a); RequireForeground(t); TypeText(o, t, Json.Str(a, "text", 64), Json.Num(a, "keyIntervalMs", 45, 0, 2000), Json.Num(a, "keyHoldMs", 12, 0, 500)); return r; }
            case "clear-field": { Target t = Check(a); RequireForeground(t); long f = FocusedField(t, a); Clear(o, t, f, a); r["text"] = os.ControlText(f); return r; }
            case "read-text": { Target t = Check(a, false); long f = os.FocusedControl(t.Hwnd); Dictionary<string, object> p = Json.Get(a, "point") as Dictionary<string, object>; if (p != null) { long c = os.ChildAt(Json.Int(p, "x", 0, -100000, 100000), Json.Int(p, "y", 0, -100000, 100000)); if (c != 0 && c != t.Hwnd) f = c; }
                r["control"] = Json.Hex(f); r["class"] = os.ControlClass(f); r["text"] = f == 0 ? null : os.ControlText(f); r["focused"] = f != 0 && f == os.FocusedControl(t.Hwnd); r["uia"] = Uia.Available ? Uia.FocusedValue() : null; return r; }
            case "enter-text": return EnterText(o, a, r);
            case "uia-controls": { Target t = Check(a, false); r["controls"] = Uia.Available ? Uia.Controls(t.Hwnd) : new List<object>(); r["available"] = Uia.Available; return r; }
            case "wait": { double ms = Json.Num(a, "ms", 0, 0, 10000); Sleep(o, ms); return r; }
        }
        throw new DriverError("unknown-command", "Unknown command.");
    }
    static int Btn(Dictionary<string, object> a) { string b = Json.Get(a, "button") as string; if (b == null || b == "left") return 0; if (b == "right") return 1; throw new DriverError("bad-request", "button must be left or right."); }

    Dictionary<string, object> Describe(WinInfo w) {
        Dictionary<string, object> d = new Dictionary<string, object>(); d["hwnd"] = Json.Hex(w.Hwnd); d["pid"] = w.Pid; d["processStart"] = w.ProcessStart.ToString(Json.C); d["title"] = w.Title; d["className"] = w.ClassName; d["exe"] = w.Exe;
        d["window"] = Json.Box(w.Window); d["client"] = Json.Box(w.Client); d["dpiScale"] = w.DpiScale; d["minimized"] = w.Minimized; d["visible"] = w.Visible; d["cloaked"] = w.Cloaked; d["foreground"] = w.Foreground; d["enabled"] = w.Enabled; d["monitor"] = w.Monitor;
        lock (targets) d["registered"] = targets.ContainsKey(w.Hwnd); return d;
    }

    /* ---------------- authorisation of targets ---------------- */
    Dictionary<string, object> Register(Dictionary<string, object> a, Dictionary<string, object> r) {
        Dictionary<string, object> auth = Json.Obj(Json.Get(a, "authorization"));
        if ((Json.Get(auth, "format") as string) != "eightmax-simulator-authorization" || Convert.ToInt32(Json.Get(auth, "version") ?? 0) != 1) throw new DriverError("authorization-refused", "Needs an eightmax-simulator-authorization v1 record.");
        foreach (string k in new[] { "operatorOwnsSimulator", "testEnvironmentOnly", "noRealMoney" }) if (!(Json.Get(auth, k) is bool) || !(bool)Json.Get(auth, k)) throw new DriverError("authorization-refused", "The authorization must state " + k + ": true.");
        double expires = Json.Num(auth, "expiresAtUnixMs", 0, 0, 1e15), now = (DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        if (expires <= now) throw new DriverError("authorization-refused", "The authorization has expired."); if (expires - now > 8 * 3600e3 + 60e3) throw new DriverError("authorization-refused", "An authorization may last at most 8 hours.");
        Dictionary<string, object> exe = Json.Obj(Json.Get(auth, "executable")); string name = Json.Str(exe, "fileName", 260), sha = Json.Str(exe, "sha256", 64).ToLowerInvariant();
        long hwnd = Json.Handle(Json.Get(a, "hwnd")); WinInfo w = os.Window(hwnd); if (w == null) throw new DriverError("window-gone", "That window no longer exists.");
        if (!String.Equals(Path.GetFileName(w.Exe), name, StringComparison.OrdinalIgnoreCase)) throw new DriverError("authorization-refused", "The window belongs to " + Path.GetFileName(w.Exe) + ", not the authorised " + name + ".");
        string actual = os.ExeSha256(w.Pid); if (actual == null || actual != sha) throw new DriverError("authorization-refused", "The program's SHA-256 (" + (actual ?? "unreadable") + ") differs from the authorised executable.");
        Target t = new Target { Hwnd = hwnd, Pid = w.Pid, ProcessStart = w.ProcessStart, ClassName = w.ClassName, Exe = w.Exe, ExeSha256 = sha, Label = Json.Get(a, "label") as string ?? "", Expires = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMilliseconds(expires) };
        lock (targets) { if (targets.Count >= 16 && !targets.ContainsKey(hwnd)) throw new DriverError("too-many-targets", "At most 16 windows can be registered."); targets[hwnd] = t; }
        r["window"] = Describe(w); r["exeSha256"] = sha; return r;
    }
    /// <summary>The window named by the request must be registered and still be the same window.</summary>
    Target Check(Dictionary<string, object> a) { return Check(a, true); }
    Target Check(Dictionary<string, object> a, bool forInput) {
        long h = Json.Handle(Json.Get(a, "hwnd")); Target t; lock (targets) targets.TryGetValue(h, out t);
        if (t == null) throw new DriverError("target-not-registered", "Input goes only to a registered, authorised simulator window.");
        if (DateTime.UtcNow > t.Expires) throw new DriverError("authorization-expired", "The authorization for this window expired.");
        WinInfo w = Identity(t); if (forInput && w.Minimized) throw new DriverError("window-minimized", "The simulator window is minimised.");
        if (forInput && (!w.Visible || w.Cloaked)) throw new DriverError("window-hidden", "The simulator window is hidden or on another virtual desktop.");
        Dictionary<string, object> exp = Json.Get(a, "expectClient") as Dictionary<string, object>;
        if (exp != null && !Json.Box(exp).Same(w.Client)) throw new DriverError("layout-changed", "The window moved or was resized (client " + w.Client + ", expected " + Json.Box(exp) + "); take a new screenshot first.");
        return t;
    }
    WinInfo Identity(Target t) {
        WinInfo w = os.Window(t.Hwnd); if (w == null) { lock (targets) targets.Remove(t.Hwnd); throw new DriverError("window-gone", "The simulator window was closed."); }
        if (w.Pid != t.Pid || w.ProcessStart != t.ProcessStart || w.ClassName != t.ClassName) throw new DriverError("identity-changed", "The window handle now belongs to a different window or process.");
        return w;
    }
    void RequireForeground(Target t) { if (os.Foreground() != t.Hwnd) throw new DriverError("focus-lost", "The simulator window is not in the foreground; keyboard input refused."); }
    void Focus(Target t, bool force) {
        if (os.Foreground() == t.Hwnd) return; if (!force) throw new DriverError("focus-lost", "The simulator window is not in the foreground.");
        if (!os.SetForeground(t.Hwnd)) throw new DriverError("focus-denied", "Windows did not let the driver bring the simulator window to the front.");
    }
    /// <summary>The visible window under (x,y) must be the target itself, otherwise the click would land on another program.</summary>
    void HitCheck(Target t, Dictionary<string, object> a, int x, int y) {
        Dictionary<string, object> reg = Json.Get(a, "region") as Dictionary<string, object>;
        if (reg != null && !Json.Box(reg).Contains(x, y)) throw new DriverError("outside-region", "The cursor (" + x + "," + y + ") is not inside the validated control region " + Json.Box(reg) + ".");
        WinInfo w = Identity(t); if (!w.Client.Contains(x, y)) throw new DriverError("outside-window", "The point is outside the simulator's client area.");
        long root = os.RootAt(x, y);
        if (root != t.Hwnd) {
            string policy = Json.Get(a, "focusPolicy") as string ?? "bring-to-front";
            if (policy == "bring-to-front") { Focus(t, true); Thread.Sleep(30); root = os.RootAt(x, y); }
            if (root != t.Hwnd) throw new DriverError("target-covered", "Another window (" + Json.Hex(root) + ") covers the control.");
        }
    }

    /* ---------------- cursor ownership / manual override between operations ---------------- */
    void RememberCursor() { int x, y; os.GetCursor(out x, out y); lastX = x; lastY = y; }
    void NoteInput() { RememberCursor(); }
    void CheckCursorOwnership() {
        if (lastX == int.MinValue) { RememberCursor(); return; }
        int x, y; os.GetCursor(out x, out y);
        if (Math.Abs(x - lastX) > OverrideTolerancePx || Math.Abs(y - lastY) > OverrideTolerancePx) {
            if (armed && os.Ticks() - armedAt >= OverrideGraceMs) { PhysicalInput("cursor moved from " + lastX + "," + lastY + " to " + x + "," + y + " between operations"); throw new DriverError("manual-override", "The cursor was moved by someone else; automation yielded."); }
            RememberCursor();
        }
    }
    void Sleep(Op o, double ms) { long end = os.Ticks() + (long)Math.Ceiling(ms); while (true) { Gate(o); long left = end - os.Ticks(); if (left <= 0) return; Thread.Sleep((int)Math.Min(left, 10)); } }

    /* ---------------- movement ---------------- */
    void MoveTo(Op o, Target t, Dictionary<string, object> a, Dictionary<string, object> r) {
        Dictionary<string, object> to = Json.Obj(Json.Get(a, "to")); int tx = Json.Int(to, "x", 0, -100000, 100000), ty = Json.Int(to, "y", 0, -100000, 100000);
        MotionProfile p = MotionProfile.From(Json.Get(a, "motion") as Dictionary<string, object>);
        WinInfo w0 = Identity(t); if (!w0.Client.Contains(tx, ty)) throw new DriverError("outside-window", "The destination is outside the simulator's client area.");
        Dictionary<string, object> reg = Json.Get(a, "region") as Dictionary<string, object>; if (reg != null && !Json.Box(reg).Contains(tx, ty)) throw new DriverError("outside-region", "The destination is not inside the validated control region.");
        int x0, y0; os.GetCursor(out x0, out y0); double dist = Math.Sqrt((double)(tx - x0) * (tx - x0) + (double)(ty - y0) * (ty - y0));
        double dur = Motion.DurationMs(dist, p); int steps = Motion.Steps(dur, p);
        if (dur > p.MaxDurationMs) throw new DriverError("move-too-long", "The movement would take " + Math.Round(dur) + " ms (limit " + p.MaxDurationMs + " ms) at the configured speed; it is not sped up.");
        double deadline = Json.Num(a, "mustFinishWithinMs", 1e9, 0, 1e9);
        if (dur > deadline) throw new DriverError("deadline", "The movement needs " + Math.Round(dur) + " ms but only " + Math.Round(deadline) + " ms remain; refused instead of moving faster.");
        List<object> samples = new List<object>(); Rect client0 = w0.Client; long t0 = os.Ticks(); Stopwatch sw = Stopwatch.StartNew(); int px = x0, py = y0, maxDev = 0;
        for (int k = 1; k <= steps; k++) {
            double due = dur * k / steps; double wait = due - sw.Elapsed.TotalMilliseconds;
            while (wait > 0) { Gate(o); Thread.Sleep(wait > 3 ? (int)(wait - 2) : 0); wait = due - sw.Elapsed.TotalMilliseconds; }
            Gate(o);
            // Someone else moved the cursor since the last step? (Raw Input catches it first when available.)
            int cx, cy; os.GetCursor(out cx, out cy); int dev = Math.Max(Math.Abs(cx - px), Math.Abs(cy - py)); if (dev > maxDev) maxDev = dev;
            if (dev > OverrideTolerancePx && k > 1) { PhysicalInput("cursor moved by someone else during a movement"); throw new DriverError("manual-override", "The cursor was moved by someone else during the movement."); }
            if ((k & 3) == 0 || k == steps) { WinInfo w = Identity(t); if (!w.Client.Same(client0)) throw new DriverError("layout-changed", "The simulator window moved or was resized during the movement; stopped."); if (w.Minimized) throw new DriverError("window-minimized", "The window was minimised during the movement."); }
            PathPoint q = Motion.At(x0, y0, tx, ty, (double)k / steps, p.Arc); int nx = (int)Math.Round(q.X), ny = (int)Math.Round(q.Y); if (k == steps) { nx = tx; ny = ty; }
            os.MoveAbsolute(nx, ny); px = nx; py = ny; stats.Moves++;
            if (samples.Count < 2000) { Dictionary<string, object> s = new Dictionary<string, object>(); s["t"] = Math.Round(sw.Elapsed.TotalMilliseconds, 2); s["x"] = nx; s["y"] = ny; samples.Add(s); }
        }
        // Final position check; a mapping rounding error of at most 2 px is corrected, anything larger is an error.
        int fx, fy; Thread.Sleep(2); os.GetCursor(out fx, out fy); int err = Math.Max(Math.Abs(fx - tx), Math.Abs(fy - ty));
        if (err > 0) { if (err > 2) throw new DriverError("target-miss", "The cursor ended at " + fx + "," + fy + " instead of " + tx + "," + ty + "."); os.SetCursor(tx, ty); stats.Corrections++; if (err > stats.MaxCorrection) stats.MaxCorrection = err; }
        RememberCursor();
        r["from"] = Pt(x0, y0); r["to"] = Pt(tx, ty); r["distance"] = Math.Round(dist, 2); r["plannedMs"] = Math.Round(dur, 2); r["actualMs"] = Math.Round(sw.Elapsed.TotalMilliseconds, 2); r["steps"] = steps; r["samples"] = samples; r["finalError"] = err; r["maxObservedLag"] = maxDev; r["startedAt"] = t0;
    }
    static Dictionary<string, object> Pt(int x, int y) { Dictionary<string, object> d = new Dictionary<string, object>(); d["x"] = x; d["y"] = y; return d; }

    void ClickAt(Op o, Target t, Dictionary<string, object> a, Dictionary<string, object> r, int count) {
        double pre = Json.Num(a, "preClickMs", 60, 0, 2000), hold = Json.Num(a, "holdMs", 70, 10, 1000), gap = Json.Num(a, "doubleGapMs", 120, 40, 400); int b = Btn(a);
        Sleep(o, pre);
        int x, y; os.GetCursor(out x, out y); Gate(o); HitCheck(t, a, x, y);   // revalidate right before pressing
        long child = os.ChildAt(x, y); r["hit"] = Json.Hex(child); r["hitClass"] = os.ControlClass(child);
        string want = Json.Get(a, "expectClass") as string; if (want != null && want.Length > 0 && os.ControlClass(child).IndexOf(want, StringComparison.OrdinalIgnoreCase) < 0) throw new DriverError("unexpected-control", "The control under the cursor is a " + os.ControlClass(child) + ", not the expected " + want + ".");
        // Two separate single clicks on the same spot within the system double-click time are a DOUBLE-click to Windows
        // (found by the 0.35 Windows acceptance). Unless a double-click was asked for, wait until a new press cannot pair up.
        int dw, dh; os.DoubleClickSize(out dw, out dh); long since = os.Ticks() - lastClickAt;
        if (count == 1 && lastClickAt > 0 && Math.Abs(x - lastClickX) <= dw && Math.Abs(y - lastClickY) <= dh && since < os.DoubleClickMs() + 40) { long wait = os.DoubleClickMs() + 40 - since; r["doubleClickGuardMs"] = wait; stats.DoubleClickGuards++; Sleep(o, wait); HitCheck(t, a, x, y); }
        for (int i = 0; i < count; i++) {
            Gate(o); Down(b); stats.Clicks++;
            try { Thread.Sleep((int)hold); } finally { Up(b); }   // the button is released even if a stop arrives during the hold
            if (i + 1 < count) Thread.Sleep((int)gap);
        }
        lastClickAt = os.Ticks(); lastClickX = x; lastClickY = y;
        RememberCursor(); r["clickedAt"] = Pt(x, y); r["clicks"] = count; r["holdMs"] = hold;
    }

    /* ---------------- keyboard ---------------- */
    static readonly Dictionary<string, ushort> Named = new Dictionary<string, ushort> { { "backspace", 0x08 }, { "tab", 0x09 }, { "enter", 0x0D }, { "escape", 0x1B }, { "delete", 0x2E }, { "home", 0x24 }, { "end", 0x23 }, { "left", 0x25 }, { "right", 0x27 } };
    void PressKey(Op o, Target t, Dictionary<string, object> a) {
        string k = Json.Str(a, "key", 20); ushort vk; if (!Named.TryGetValue(k, out vk)) throw new DriverError("bad-request", "Key must be one of backspace, tab, enter, escape, delete, home, end, left, right.");
        int repeat = Json.Int(a, "repeat", 1, 1, 64); double gap = Json.Num(a, "keyIntervalMs", 40, 0, 2000), hold = Json.Num(a, "keyHoldMs", 12, 0, 500);
        for (int i = 0; i < repeat; i++) { Gate(o); RequireForeground(t); KeyDown(vk); try { Thread.Sleep((int)hold); } finally { KeyUp(vk); } stats.Keys++; NoteKey(); if (i + 1 < repeat) Sleep(o, gap); }
    }
    void NoteKey() { }
    void TypeText(Op o, Target t, string text, double gap, double hold) {
        foreach (char c in text) {
            Gate(o); RequireForeground(t);
            ushort vk = c >= '0' && c <= '9' ? (ushort)c : c == '.' ? (ushort)0xBE : (ushort)0;
            if (vk != 0) { KeyDown(vk); try { Thread.Sleep((int)hold); } finally { KeyUp(vk); } }
            else { if (c < 32 || c == 127) throw new DriverError("bad-request", "Control characters cannot be typed; use key."); os.Unicode(c, true); try { Thread.Sleep((int)hold); } finally { os.Unicode(c, false); } }
            stats.Chars++; Sleep(o, gap);
        }
    }
    long FocusedField(Target t, Dictionary<string, object> a) {
        long f = os.FocusedControl(t.Hwnd); if (f == 0 || f == t.Hwnd) throw new DriverError("field-not-focused", "No text field has the keyboard focus in the simulator window.");
        string cls = os.ControlClass(f); if (cls.IndexOf("edit", StringComparison.OrdinalIgnoreCase) < 0) throw new DriverError("field-not-focused", "The focused control is a " + cls + ", not a text field.");
        Dictionary<string, object> p = Json.Get(a, "to") as Dictionary<string, object>;
        if (p != null) { long under = os.ChildAt(Json.Int(p, "x", 0, -100000, 100000), Json.Int(p, "y", 0, -100000, 100000)); if (under != f) throw new DriverError("field-not-focused", "The focused field is not the calibrated wager field."); }
        return f;
    }
    void Clear(Op o, Target t, long f, Dictionary<string, object> a) {
        string cur = os.ControlText(f); if (cur == null) throw new DriverError("field-unreadable", "The wager field's text cannot be read, so it cannot be verified.");
        if (cur.Length == 0) return; if (cur.Length > 32) throw new DriverError("field-unexpected", "The wager field holds " + cur.Length + " characters; refusing to clear it blind.");
        Dictionary<string, object> k = new Dictionary<string, object>(a); k["key"] = "end"; k["repeat"] = 1; PressKey(o, t, k);
        k["key"] = "backspace"; k["repeat"] = cur.Length + 1; PressKey(o, t, k);
        string after = os.ControlText(f); if (after == null || after.Length != 0) throw new DriverError("clear-failed", "The wager field still shows '" + after + "' after clearing.");
    }
    /// <summary>Click the calibrated field, verify it has the focus, clear it, type sequentially, read it back. Nothing is submitted here.</summary>
    Dictionary<string, object> EnterText(Op o, Dictionary<string, object> a, Dictionary<string, object> r) {
        Gate(o); if (!armed) throw new DriverError("not-armed", "Automation is not enabled.");
        Target t = Check(a); string text = Json.Str(a, "text", 24); if (text.Length == 0) throw new DriverError("bad-request", "Empty amount.");
        foreach (char c in text) if (!(c >= '0' && c <= '9' || c == '.')) throw new DriverError("bad-request", "A wager may contain digits and one decimal point only.");
        double gap = Json.Num(a, "keyIntervalMs", 45, 0, 2000), hold = Json.Num(a, "keyHoldMs", 12, 0, 500), settle = Json.Num(a, "focusSettleMs", 80, 0, 2000);
        MoveTo(o, t, a, r); ClickAt(o, t, a, r, 1); Sleep(o, settle);
        RequireForeground(t); long f = FocusedField(t, a); r["field"] = Json.Hex(f);
        Clear(o, t, f, a); TypeText(o, t, text, gap, hold); Sleep(o, Math.Max(30, gap));
        string seen = os.ControlText(f); r["typed"] = text; r["read"] = seen; r["verified"] = seen == text;
        if (seen != text) { try { Clear(o, t, f, a); } catch (DriverError) { } throw new DriverError("verify-mismatch", "The wager field shows '" + seen + "' instead of '" + text + "'; it was cleared and nothing was submitted."); }
        return r;
    }
}

/// <summary>Independent cursor sampler (its own thread) for movement validation: position and left-button state every few ms.</summary>
public sealed class CursorMonitor {
    readonly IPlatform os; readonly int interval, max; readonly List<int[]> samples = new List<int[]>(); volatile bool run; Thread th; public int ButtonDown;
    public CursorMonitor(IPlatform os, int intervalMs, int max) { this.os = os; interval = intervalMs; this.max = max; }
    public void Start() { run = true; th = new Thread(Loop) { IsBackground = true, Name = "cursor-monitor", Priority = ThreadPriority.AboveNormal }; th.Start(); }
    void Loop() { Stopwatch sw = Stopwatch.StartNew(); while (run) { int x, y; os.GetCursor(out x, out y); bool down = os.IsKeyDown(1); lock (samples) { if (samples.Count < max) samples.Add(new int[] { (int)(sw.Elapsed.TotalMilliseconds * 10), x, y, down ? 1 : 0 }); } if (down) ButtonDown++; Thread.Sleep(interval); } }
    public void Stop() { run = false; if (th != null) th.Join(1000); }
    public object[] Samples() { lock (samples) { object[] a = new object[samples.Count]; for (int i = 0; i < a.Length; i++) a[i] = samples[i]; return a; } }
}
}
