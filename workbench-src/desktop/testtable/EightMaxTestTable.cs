// EightMax Test Workbench 0.35.0 - EightMaxTestTable.exe: the CONTROLLED WINDOWS TEST TABLE used to validate real input.
//
// A testing fixture, not a poker client: an ordinary resizable Win32 window with real buttons (Fold, Check, Call, Raise,
// All-in) and a real text field for the wager. It draws whatever frame its dealer (tools/test-table-035.cjs, a separate
// process running the EightMax engine) sends it, and reports every button press, mouse press/release and key to the dealer,
// which records them in an ORACLE file. The Workbench's decision path never sees the dealer or the oracle: it reads the
// window's pixels through screen capture and acts through the input driver like it would on any simulator.
// The buttons paint the dealer's own frame pixels (so the image the Workbench reads is exactly the rendered table) but are
// genuine Win32 BUTTON controls with names, so Windows UI Automation and keyboard focus work normally.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("EightMax controlled test table (input validation fixture)")]
[assembly: System.Reflection.AssemblyProduct("EightMax Test Workbench")]
[assembly: System.Reflection.AssemblyVersion("0.35.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("0.35.0.0")]
[assembly: System.Reflection.AssemblyInformationalVersion("0.35.0")]
namespace EightMax.TestTable {
public sealed class FrameButton : Button {
    public string Control = ""; public TableForm Owner2; public string Label = "";
    public FrameButton() { SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true); FlatStyle = FlatStyle.Flat; FlatAppearance.BorderSize = 0; TabStop = false; UseVisualStyleBackColor = false; }
    protected override void OnPaintBackground(PaintEventArgs e) { }
    protected override void OnPaint(PaintEventArgs e) {
        // Exactly the frame pixels under the button (so the captured window equals the rendered table), plus an optional label.
        Owner2.PaintFrameRegion(e.Graphics, Bounds);
        if (Label.Length > 0) using (Font f = new Font("Segoe UI", Math.Max(7f, Height * 0.42f), FontStyle.Bold, GraphicsUnit.Pixel)) using (Brush b = new SolidBrush(Enabled ? Color.FromArgb(20, 20, 20) : Color.FromArgb(120, 120, 120)))
            TextRenderer.DrawText(e.Graphics, Label, f, ClientRectangle, Enabled ? Color.FromArgb(20, 20, 20) : Color.FromArgb(120, 120, 120), TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
    }
}

public sealed class TableForm : Form, IMessageFilter {
    // Layout of the fixture's own controls, as fractions of the client area (same numbers as the shipped calibration profile).
    public static readonly Dictionary<string, RectangleF> Regions = new Dictionary<string, RectangleF> {
        { "fold", new RectangleF(0.60f, 0.93f, 0.10f, 0.05f) }, { "check", new RectangleF(0.72f, 0.93f, 0.10f, 0.05f) }, { "call", new RectangleF(0.84f, 0.93f, 0.07f, 0.05f) },
        { "raise", new RectangleF(0.92f, 0.93f, 0.07f, 0.05f) }, { "allin", new RectangleF(0.60f, 0.87f, 0.10f, 0.05f) }, { "wager", new RectangleF(0.42f, 0.93f, 0.15f, 0.05f) } };
    const float Aspect = 1.6f;
    readonly JavaScriptSerializer js = new JavaScriptSerializer { MaxJsonLength = 64 * 1024 * 1024 };
    readonly TextWriter output; readonly object outGate = new object(); readonly int table; readonly string titleBase;
    readonly Dictionary<string, FrameButton> buttons = new Dictionary<string, FrameButton>(); public readonly TextBox Wager = new TextBox();
    Bitmap frame; long frameRev = -1; System.Windows.Forms.Timer resizeTimer; bool closingByDealer;
    public TableForm(int table, string title, int x, int y, int clientW, TextWriter output) {
        this.table = table; this.output = output; titleBase = title; Text = title; AutoScaleMode = AutoScaleMode.None; StartPosition = FormStartPosition.Manual; Location = new Point(x, y);
        DoubleBuffered = true; SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true); BackColor = Color.FromArgb(40, 40, 40);
        MinimumSize = new Size(320, 240); ClientSize = new Size(clientW, (int)Math.Round(clientW / Aspect)); KeyPreview = false;
        foreach (string k in new[] { "fold", "check", "call", "raise", "allin" }) { FrameButton b = new FrameButton(); b.Control = k; b.Owner2 = this; b.Name = k; b.Text = k == "allin" ? "All-in" : Char.ToUpperInvariant(k[0]) + k.Substring(1); b.AccessibleName = b.Text; b.Enabled = false; if (k == "allin") b.Label = "ALL-IN";
            string ctl = k; b.Click += delegate { OnAction(ctl); }; buttons[k] = b; Controls.Add(b); }
        Wager.Name = "wager"; Wager.AccessibleName = "Wager amount"; Wager.BorderStyle = BorderStyle.FixedSingle; Wager.MaxLength = 16; Wager.TextAlign = HorizontalAlignment.Right; Controls.Add(Wager);
        resizeTimer = new System.Windows.Forms.Timer { Interval = 150 }; resizeTimer.Tick += delegate { resizeTimer.Stop(); SendResize(); };
        Layout2(); Application.AddMessageFilter(this);
    }
    void Layout2() {
        Size c = ClientSize; foreach (KeyValuePair<string, FrameButton> kv in buttons) kv.Value.Bounds = Px(Regions[kv.Key], c);
        Rectangle wr = Px(Regions["wager"], c); Wager.Font = new Font("Segoe UI", Math.Max(8f, wr.Height * 0.62f), GraphicsUnit.Pixel); Wager.Bounds = wr;
    }
    static Rectangle Px(RectangleF f, Size c) { int x0 = (int)Math.Floor(f.X * c.Width), y0 = (int)Math.Floor(f.Y * c.Height), x1 = (int)Math.Ceiling((f.X + f.Width) * c.Width), y1 = (int)Math.Ceiling((f.Y + f.Height) * c.Height); return new Rectangle(x0, y0, x1 - x0, y1 - y0); }

    /* ---------- painting ---------- */
    protected override void OnPaint(PaintEventArgs e) { PaintFrameRegion(e.Graphics, ClientRectangle); }
    protected override void OnPaintBackground(PaintEventArgs e) { }
    public void PaintFrameRegion(Graphics g, Rectangle area) {
        if (frame == null) { using (Brush b = new SolidBrush(BackColor)) g.FillRectangle(b, 0, 0, area.Width, area.Height); return; }
        g.InterpolationMode = InterpolationMode.NearestNeighbor; g.PixelOffsetMode = PixelOffsetMode.Half; g.CompositingMode = CompositingMode.SourceCopy;
        Size c = ClientSize;
        if (frame.Width == c.Width && frame.Height == c.Height) g.DrawImage(frame, new Rectangle(0, 0, area.Width, area.Height), area, GraphicsUnit.Pixel);
        else { float sx = (float)frame.Width / c.Width, sy = (float)frame.Height / c.Height; g.DrawImage(frame, new Rectangle(0, 0, area.Width, area.Height), new RectangleF(area.X * sx, area.Y * sy, area.Width * sx, area.Height * sy), GraphicsUnit.Pixel); }
    }

    /* ---------- keep the client area at the table's 1.6 aspect while the operator resizes ---------- */
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
    protected override void WndProc(ref Message m) {
        if (m.Msg == 0x0214 /*WM_SIZING*/) {
            RECT r = (RECT)Marshal.PtrToStructure(m.LParam, typeof(RECT)); int fw = Width - ClientSize.Width, fh = Height - ClientSize.Height; int cw = Math.Max(320, r.R - r.L - fw), ch = (int)Math.Round(cw / Aspect); int edge = m.WParam.ToInt32();
            if (edge == 3 || edge == 6) { ch = Math.Max(200, r.B - r.T - fh); cw = (int)Math.Round(ch * Aspect); r.R = r.L + cw + fw; } else r.B = r.T + ch + fh;
            Marshal.StructureToPtr(r, m.LParam, false); m.Result = new IntPtr(1); return;
        }
        base.WndProc(ref m);
    }
    protected override void OnResize(EventArgs e) { base.OnResize(e); if (WindowState == FormWindowState.Minimized) { Send(Ev("minimized")); return; } Layout2(); Invalidate(true); if (resizeTimer != null) { resizeTimer.Stop(); resizeTimer.Start(); } }
    protected override void OnMove(EventArgs e) { base.OnMove(e); if (IsHandleCreated) Send(Moved()); }
    Dictionary<string, object> Moved() { Dictionary<string, object> d = Ev("moved"); Point o = PointToScreen(Point.Empty); d["x"] = o.X; d["y"] = o.Y; return d; }
    void SendResize() { Dictionary<string, object> d = Ev("resize"); d["w"] = ClientSize.Width; d["h"] = ClientSize.Height; Send(d); }
    protected override void OnShown(EventArgs e) {
        base.OnShown(e); Dictionary<string, object> d = Ev("ready"); d["hwnd"] = "0x" + Handle.ToInt64().ToString("X"); d["pid"] = System.Diagnostics.Process.GetCurrentProcess().Id; Point o = PointToScreen(Point.Empty);
        d["client"] = Box(new Rectangle(o.X, o.Y, ClientSize.Width, ClientSize.Height)); d["dpi"] = DeviceDpi(); d["controls"] = ControlBoxes(); Send(d);
    }
    float DeviceDpi() { using (Graphics g = CreateGraphics()) return g.DpiX; }
    Dictionary<string, object> ControlBoxes() { Dictionary<string, object> d = new Dictionary<string, object>(); foreach (KeyValuePair<string, FrameButton> kv in buttons) d[kv.Key] = Box(RectangleToScreen(kv.Value.Bounds)); d["wager"] = Box(RectangleToScreen(Wager.Bounds)); return d; }
    static Dictionary<string, object> Box(Rectangle r) { Dictionary<string, object> d = new Dictionary<string, object>(); d["x"] = r.X; d["y"] = r.Y; d["w"] = r.Width; d["h"] = r.Height; return d; }
    protected override void OnFormClosed(FormClosedEventArgs e) { Send(Ev(closingByDealer ? "closed" : "closed-by-user")); base.OnFormClosed(e); }

    /* ---------- the oracle feed: every press/release and key, with client coordinates ---------- */
    public bool PreFilterMessage(ref Message m) {
        int msg = m.Msg; if (msg != 0x0201 && msg != 0x0202 && msg != 0x0203 && msg != 0x0204 && msg != 0x0100) return false;
        Control c = Control.FromHandle(m.HWnd); if (c == null || c.FindForm() != this) return false;
        Dictionary<string, object> d;
        if (msg == 0x0100) { d = Ev("key"); d["vk"] = m.WParam.ToInt32(); d["control"] = c.Name.Length > 0 ? c.Name : "form"; Send(d); return false; }
        int lp = m.LParam.ToInt32(); Point local = new Point((short)(lp & 0xFFFF), (short)((lp >> 16) & 0xFFFF)); Point client = PointToClient(c.PointToScreen(local));
        d = Ev(msg == 0x0201 ? "mouse-down" : msg == 0x0202 ? "mouse-up" : msg == 0x0203 ? "double-click" : "right-down"); d["x"] = client.X; d["y"] = client.Y; d["control"] = c == this ? "table" : c.Name; d["enabled"] = c.Enabled; d["rev"] = frameRev; Send(d); return false;
    }
    void OnAction(string control) { Dictionary<string, object> d = Ev("action"); d["control"] = control; d["wager"] = Wager.Text; d["rev"] = frameRev; Send(d); }
    Dictionary<string, object> Ev(string type) { Dictionary<string, object> d = new Dictionary<string, object>(); d["type"] = type; d["table"] = table; d["t"] = Environment.TickCount; return d; }
    public void Send(Dictionary<string, object> d) { string line = js.Serialize(d); lock (outGate) { try { output.Write(line); output.Write('\n'); output.Flush(); } catch (IOException) { } } }

    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out int pid);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    /// <summary>Test scenario "focus loss": this table takes the foreground from whatever has it (documented AttachThreadInput pattern).</summary>
    void ForceForeground() {
        if (SetForegroundWindow(Handle) && GetForegroundWindow() == Handle) return; int pid; uint fg = GetWindowThreadProcessId(GetForegroundWindow(), out pid), me = GetCurrentThreadId();
        bool at = fg != 0 && fg != me && AttachThreadInput(me, fg, true); try { BringToFront(); Activate(); SetForegroundWindow(Handle); } finally { if (at) AttachThreadInput(me, fg, false); }
        Dictionary<string, object> d = Ev("activated"); d["foreground"] = GetForegroundWindow() == Handle; Send(d);
    }
    /* ---------- dealer commands ---------- */
    public void Command(string line) {
        Dictionary<string, object> m; try { m = (Dictionary<string, object>)js.DeserializeObject(line); } catch (Exception) { return; }
        string type = m.ContainsKey("type") ? m["type"] as string : "";
        switch (type) {
            case "frame": {
                byte[] png = Convert.FromBase64String((string)m["png"]); Bitmap b; using (MemoryStream ms = new MemoryStream(png)) using (Image img = Image.FromStream(ms)) b = new Bitmap(img);
                Bitmap old = frame; frame = b; frameRev = Convert.ToInt64(m["rev"]); if (old != null) old.Dispose();
                Dictionary<string, object> legal = m.ContainsKey("legal") ? m["legal"] as Dictionary<string, object> : null;
                foreach (KeyValuePair<string, FrameButton> kv in buttons) kv.Value.Enabled = legal != null && legal.ContainsKey(kv.Key) && (bool)legal[kv.Key];
                if (m.ContainsKey("clearWager") && (bool)m["clearWager"]) Wager.Text = "";
                if (m.ContainsKey("title") && m["title"] is string) Text = titleBase + (string)m["title"];
                Invalidate(true); Update(); Dictionary<string, object> d = Ev("shown"); d["rev"] = frameRev; d["w"] = b.Width; d["h"] = b.Height; Send(d); return; }
            case "move": { WindowState = FormWindowState.Normal; Location = new Point(Convert.ToInt32(m["x"]), Convert.ToInt32(m["y"])); if (m.ContainsKey("w")) { int w = Convert.ToInt32(m["w"]); ClientSize = new Size(w, (int)Math.Round(w / Aspect)); } Send(Moved()); SendResize(); return; }
            case "minimize": WindowState = FormWindowState.Minimized; return;
            case "restore": WindowState = FormWindowState.Normal; return;
            case "activate": ForceForeground(); return;
            case "close": closingByDealer = true; Close(); return;
            case "describe": { Dictionary<string, object> d = Ev("describe"); Point o = PointToScreen(Point.Empty); d["client"] = Box(new Rectangle(o.X, o.Y, ClientSize.Width, ClientSize.Height)); d["controls"] = ControlBoxes(); d["wager"] = Wager.Text; Send(d); return; }
        }
    }
}

public static class Program {
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [STAThread] public static int Main(string[] args) {
        int table = 1, x = 40, y = 40, w = 960; string title = null;
        for (int i = 0; i < args.Length; i++) {
            if (args[i] == "--version") { Console.WriteLine("EightMaxTestTable 0.35.0 (controlled input-validation fixture)"); return 0; }
            if (i + 1 >= args.Length) { Console.Error.WriteLine("Missing value for " + args[i]); return 2; }
            string v = args[++i]; switch (args[i - 1]) { case "--table": table = Int32.Parse(v); break; case "--x": x = Int32.Parse(v); break; case "--y": y = Int32.Parse(v); break; case "--width": w = Int32.Parse(v); break; case "--title": title = v; break; default: Console.Error.WriteLine("Unknown argument " + args[i - 1]); return 2; }
        }
        try { if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware(); } catch (Exception) { try { SetProcessDPIAware(); } catch (Exception) { } }
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        TextWriter outw = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
        TableForm f = new TableForm(table, title ?? ("EightMax Test Table " + table.ToString("00")), x, y, w, outw);
        Thread reader = new Thread(delegate() {
            TextReader input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false)); string line;
            try { while ((line = input.ReadLine()) != null) { string l = line; try { f.BeginInvoke((Action)delegate { f.Command(l); }); } catch (Exception) { break; } } } catch (IOException) { }
            try { f.BeginInvoke((Action)delegate { f.Close(); }); } catch (Exception) { }   // the dealer went away: close the table
        }) { IsBackground = true, Name = "dealer-reader" };
        f.HandleCreated += delegate { reader.Start(); };
        Application.Run(f); return 0;
    }
}
}
