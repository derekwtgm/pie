// EightMax Test Workbench 0.33.0 - Windows Graphics Capture helper (operator-selected window or monitor only).
//
// STATUS 0.33.0: built and self-tested on a GitHub-hosted Windows runner (see evidence/build-evidence.json and evidence/windows-ci-runs.json).
// The 0.26.0 source never compiled (IsBorderRequired needs a newer SDK contract; the GDI+ bitmap class is not part of .NET 8).
// Treat every runtime claim as unverified until windows\Test-Wgc.ps1 passes on a real machine.
//
// Documented APIs only: Windows.Graphics.Capture (GraphicsCaptureSession, GraphicsCaptureItem via IGraphicsCaptureItemInterop,
// Direct3D11CaptureFramePool.CreateFreeThreaded / Recreate, Direct3D11CaptureFrame), Direct3D 11 (D3D11CreateDevice, staging
// texture CopyResource + Map), DXGI interop (CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess), user32.
// Never: process memory access, injection, hooks, input synthesis, hiding. The yellow capture border is deliberately left ON
// (the operator can always see that a window is being captured).
//
// usage:
//   EightMaxWgc.exe --version | --probe
//   EightMaxWgc.exe --hwnd 0x1234 [--pid N] --out frame.png [--timeout-ms 2000] [--max-latency-ms 250]          one frame
//   EightMaxWgc.exe --monitor 0x10001 --out frame.png                                                               one frame
//   EightMaxWgc.exe --session --hwnd 0x1234 [--pid N] --out-dir DIR [--fps 10] [--frames N] [--duration-ms T]
//                   [--queue 4] [--save-every 0] [--stall-ms 3000] [--timeout-ms 3000] [--emit-png]                  persistent session
//        --emit-png: each frame event carries the PNG (base64) so the desktop host can keep ONE session open per window (0.29).
//        One JSON line per event on stdout (frame, resized, minimized, restored, stalled, target-lost, summary).
//        Type "stop" + Enter (or close stdin) to end the session cleanly.
//   EightMaxWgc.exe --selftest --out-dir DIR                                                                        own test window
// Exit codes: 0 ok, 1 capture refused/failed, 2 bad arguments, 3 unsupported, 4 unexpected exception.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Windows.Graphics;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using WinRT;

namespace EightMax.Workbench.Wgc {

static class Json {
    public static string Q(string s) { var b = new StringBuilder("\""); foreach (char c in s ?? "") { if (c == '"' || c == '\\') b.Append('\\').Append(c); else if (c < 32) b.AppendFormat("\\u{0:x4}", (int)c); else b.Append(c); } return b.Append('"').ToString(); }
    public static string N(double v) { return v.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture); }
    static readonly object writeGate = new object();
    public static void Line(string json) { lock (writeGate) { Console.Out.WriteLine(json); Console.Out.Flush(); } }
}

/// <summary>0.29: PNG files are written by PngWriter.cs (restored from 0.27; bit-exact output verified by tests/wgc-027.test.cjs).</summary>
static class Png {
    public static void WriteBgra(string path, byte[] bgra, int width, int height) { string tmp = path + ".tmp"; File.WriteAllBytes(tmp, PngWriter.Encode(bgra, width, height)); File.Move(tmp, path, true); }
}

static class Native {
    [ComImport, Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IGraphicsCaptureItemInterop { IntPtr CreateForWindow([In] IntPtr window, [In] ref Guid iid); IntPtr CreateForMonitor([In] IntPtr monitor, [In] ref Guid iid); }
    [ComImport, Guid("A9B3D012-3DF2-4EE3-B8D1-8695F457D3C1"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IDirect3DDxgiInterfaceAccess { IntPtr GetInterface([In] ref Guid iid); }
    [DllImport("combase.dll")] public static extern int RoGetActivationFactory(IntPtr classId, ref Guid iid, out IntPtr factory);
    [DllImport("combase.dll", CharSet = CharSet.Unicode)] public static extern int WindowsCreateString(string src, int length, out IntPtr hstring);
    [DllImport("combase.dll")] public static extern int WindowsDeleteString(IntPtr hstring);
    [DllImport("d3d11.dll")] public static extern int D3D11CreateDevice(IntPtr adapter, int driverType, IntPtr software, uint flags, IntPtr featureLevels, uint nLevels, uint sdkVersion, out IntPtr device, out int level, out IntPtr context);
    [DllImport("d3d11.dll")] public static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr dxgiDevice, out IntPtr graphicsDevice);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
    public static readonly Guid IID_GraphicsCaptureItem = new Guid("79C3F95B-31F7-4EC2-A464-632EF5D30760");
    public static readonly Guid IID_ID3D11Texture2D = new Guid("6F15AAF2-D208-4E89-9AB4-489535D34F9C");
    public static readonly Guid IID_IDXGIDevice = new Guid("54EC77FA-1377-44E6-8C32-88FD5F44C84C");
    // vtable slots from d3d11.h: ID3D11Device::CreateTexture2D = 5; ID3D11Texture2D::GetDesc = 10;
    // ID3D11DeviceContext::Map = 14, Unmap = 15, CopyResource = 47; IUnknown::Release = 2.
    public delegate int CreateTexture2DFn(IntPtr self, ref TEXTURE2D_DESC desc, IntPtr initial, out IntPtr texture);
    public delegate void GetDescFn(IntPtr self, out TEXTURE2D_DESC desc);
    public delegate void CopyResourceFn(IntPtr self, IntPtr dst, IntPtr src);
    public delegate int MapFn(IntPtr self, IntPtr resource, uint subresource, uint mapType, uint flags, out MAPPED mapped);
    public delegate void UnmapFn(IntPtr self, IntPtr resource, uint subresource);
    public delegate uint ReleaseFn(IntPtr self);
    [StructLayout(LayoutKind.Sequential)] public struct TEXTURE2D_DESC { public uint Width, Height, MipLevels, ArraySize, Format, SampleCount, SampleQuality, Usage, BindFlags, CPUAccessFlags, MiscFlags; }
    [StructLayout(LayoutKind.Sequential)] public struct MAPPED { public IntPtr Data; public uint RowPitch, DepthPitch; }
    public static T Slot<T>(IntPtr obj, int index) where T : Delegate { IntPtr vtbl = Marshal.ReadIntPtr(obj); return Marshal.GetDelegateForFunctionPointer<T>(Marshal.ReadIntPtr(vtbl, index * IntPtr.Size)); }
    public static void Release(IntPtr p) { if (p != IntPtr.Zero) Slot<ReleaseFn>(p, 2)(p); }
    public static IntPtr ParseHandle(string s) { s = s.Trim(); return new IntPtr(s.StartsWith("0x", StringComparison.OrdinalIgnoreCase) ? Convert.ToInt64(s.Substring(2), 16) : Convert.ToInt64(s)); }
}

/// <summary>One captured frame copied to CPU memory.</summary>
sealed class Frame { public long Seq; public int Width, Height; public byte[] Bgra; public double SystemRelativeMs, ArrivedMs, AgeMs; public bool Blank; }

/// <summary>A persistent capture session: one GraphicsCaptureItem, one D3D device, one free-threaded frame pool, a bounded queue.</summary>
sealed class WgcSession : IDisposable {
    public readonly string TargetKind; readonly IntPtr handle; readonly int expectedPid;
    IntPtr device, context, staging, graphicsDevice; Native.TEXTURE2D_DESC stagingDesc; IDirect3DDevice d3d;
    GraphicsCaptureItem item; Direct3D11CaptureFramePool pool; GraphicsCaptureSession session; SizeInt32 poolSize;
    readonly object gate = new object(); readonly Queue<Frame> queue = new Queue<Frame>(); readonly int capacity; readonly double minIntervalMs;
    readonly Stopwatch clock = Stopwatch.StartNew(); double lastAcceptedMs = -1e9; bool disposed;
    public long Seq, Dropped, Throttled, Blank, Resizes, Arrived; public volatile bool ItemClosed; public string LastError;
    public readonly AutoResetEvent FrameReady = new AutoResetEvent(false);
    public event Action<string> Event;

    public WgcSession(IntPtr handle, bool monitor, int pid, int queueCapacity, double fps) {
        this.handle = handle; TargetKind = monitor ? "monitor" : "window"; expectedPid = pid; capacity = Math.Max(1, Math.Min(64, queueCapacity)); minIntervalMs = fps > 0 ? 1000.0 / fps : 0;
        item = CreateItem(handle, monitor);
        item.Closed += (s, e) => { ItemClosed = true; Raise("{\"event\":\"target-closed\",\"code\":\"target-lost\"}"); FrameReady.Set(); };
        CreateDevice();
        poolSize = item.Size; if (poolSize.Width <= 0 || poolSize.Height <= 0) throw new CaptureRefused("empty-target", "The target reports a zero size.");
        pool = Direct3D11CaptureFramePool.CreateFreeThreaded(d3d, DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, poolSize);
        pool.FrameArrived += OnFrameArrived;
        session = pool.CreateCaptureSession(item);
        try { session.IsCursorCaptureEnabled = false; } catch (Exception) { }
    }
    void Raise(string json) { var h = Event; if (h != null) try { h(json); } catch (Exception) { } }
    public SizeInt32 Size { get { return poolSize; } }
    public double NowMs { get { return clock.Elapsed.TotalMilliseconds; } }
    public void Start() { session.StartCapture(); }

    static GraphicsCaptureItem CreateItem(IntPtr handle, bool monitor) {
        IntPtr hs; Marshal.ThrowExceptionForHR(Native.WindowsCreateString("Windows.Graphics.Capture.GraphicsCaptureItem", 44, out hs));
        try {
            Guid iid = typeof(Native.IGraphicsCaptureItemInterop).GUID; IntPtr factory; Marshal.ThrowExceptionForHR(Native.RoGetActivationFactory(hs, ref iid, out factory));
            try {
                var interop = (Native.IGraphicsCaptureItemInterop)Marshal.GetObjectForIUnknown(factory); Guid itemIid = Native.IID_GraphicsCaptureItem;
                IntPtr p = monitor ? interop.CreateForMonitor(handle, ref itemIid) : interop.CreateForWindow(handle, ref itemIid);
                try { return GraphicsCaptureItem.FromAbi(p); } finally { Marshal.Release(p); }
            } finally { Marshal.Release(factory); }
        } finally { Native.WindowsDeleteString(hs); }
    }
    void CreateDevice() {
        int level; int hr = Native.D3D11CreateDevice(IntPtr.Zero, 1 /*HARDWARE*/, IntPtr.Zero, 0x20 /*BGRA_SUPPORT*/, IntPtr.Zero, 0, 7, out device, out level, out context);
        if (hr < 0) { Marshal.ThrowExceptionForHR(Native.D3D11CreateDevice(IntPtr.Zero, 5 /*WARP*/, IntPtr.Zero, 0x20, IntPtr.Zero, 0, 7, out device, out level, out context)); DeviceKind = "warp"; } else DeviceKind = "hardware";
        Guid dxgi = Native.IID_IDXGIDevice; IntPtr dxgiDevice; Marshal.ThrowExceptionForHR(Marshal.QueryInterface(device, ref dxgi, out dxgiDevice));
        try { Marshal.ThrowExceptionForHR(Native.CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice, out graphicsDevice)); } finally { Marshal.Release(dxgiDevice); }
        d3d = MarshalInterface<IDirect3DDevice>.FromAbi(graphicsDevice);
    }
    public string DeviceKind { get; private set; }

    void OnFrameArrived(Direct3D11CaptureFramePool sender, object args) {
        Frame copied = null; bool resized = false; SizeInt32 newSize = default(SizeInt32);
        try {
            using (var frame = sender.TryGetNextFrame()) {
                if (frame == null) return;
                double now = NowMs; Interlocked.Increment(ref Arrived);
                var content = frame.ContentSize;
                if (content.Width != poolSize.Width || content.Height != poolSize.Height) { resized = true; newSize = content; }
                else if (minIntervalMs > 0 && now - lastAcceptedMs < minIntervalMs) { Interlocked.Increment(ref Throttled); return; }
                else { lastAcceptedMs = now; copied = Copy(frame, now); }
            }
            if (resized && newSize.Width > 0 && newSize.Height > 0) {
                lock (gate) { if (disposed) return; poolSize = newSize; pool.Recreate(d3d, DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, newSize); Resizes++; }
                Raise("{\"event\":\"resized\",\"width\":" + newSize.Width + ",\"height\":" + newSize.Height + "}");
                return;
            }
            if (copied == null) return;
            lock (gate) { if (queue.Count >= capacity) { queue.Dequeue(); Dropped++; } queue.Enqueue(copied); }
            FrameReady.Set();
        } catch (Exception e) { LastError = e.GetType().Name + ": " + e.Message; Raise("{\"event\":\"frame-error\",\"reason\":" + Json.Q(LastError) + "}"); }
    }
    Frame Copy(Direct3D11CaptureFrame frame, double arrivedMs) {
        var access = frame.Surface.As<Native.IDirect3DDxgiInterfaceAccess>(); Guid tex = Native.IID_ID3D11Texture2D; IntPtr src = access.GetInterface(ref tex);
        try {
            Native.TEXTURE2D_DESC d; Native.Slot<Native.GetDescFn>(src, 10)(src, out d);
            lock (gate) {
                if (disposed) return null;
                if (staging == IntPtr.Zero || stagingDesc.Width != d.Width || stagingDesc.Height != d.Height) {
                    Native.Release(staging); staging = IntPtr.Zero;
                    var s = d; s.Usage = 3 /*STAGING*/; s.BindFlags = 0; s.CPUAccessFlags = 0x20000 /*READ*/; s.MiscFlags = 0; s.MipLevels = 1; s.ArraySize = 1; s.SampleCount = 1; s.SampleQuality = 0;
                    Marshal.ThrowExceptionForHR(Native.Slot<Native.CreateTexture2DFn>(device, 5)(device, ref s, IntPtr.Zero, out staging)); stagingDesc = s;
                }
                Native.Slot<Native.CopyResourceFn>(context, 47)(context, staging, src);
                Native.MAPPED m; Marshal.ThrowExceptionForHR(Native.Slot<Native.MapFn>(context, 14)(context, staging, 0, 1 /*READ*/, 0, out m));
                int w = (int)d.Width, h = (int)d.Height; var bytes = new byte[w * h * 4];
                try { for (int y = 0; y < h; y++) Marshal.Copy(m.Data + (int)(y * m.RowPitch), bytes, y * w * 4, w * 4); }
                finally { Native.Slot<Native.UnmapFn>(context, 15)(context, staging, 0); }
                bool any = false; for (int i = 0; i < bytes.Length; i += 16) if (bytes[i] != 0 || bytes[i + 1] != 0 || bytes[i + 2] != 0) { any = true; break; }
                if (!any) Interlocked.Increment(ref Blank);
                double sys = frame.SystemRelativeTime.TotalMilliseconds, qpcNow = Stopwatch.GetTimestamp() * 1000.0 / Stopwatch.Frequency;
                return new Frame { Seq = Interlocked.Increment(ref Seq), Width = w, Height = h, Bgra = bytes, SystemRelativeMs = sys, ArrivedMs = arrivedMs, AgeMs = Math.Max(0, qpcNow - sys), Blank = !any };
            }
        } finally { Native.Release(src); }
    }
    /// <summary>Takes the newest queued frame (older ones are discarded as stale and counted).</summary>
    public Frame TakeLatest() { lock (gate) { Frame f = null; while (queue.Count > 0) { if (f != null) Dropped++; f = queue.Dequeue(); } return f; } }
    public Frame WaitFrame(int timeoutMs, Func<Frame, bool> accept) {
        var w = Stopwatch.StartNew();
        while (w.ElapsedMilliseconds < timeoutMs) { var f = TakeLatest(); if (f != null && (accept == null || accept(f))) return f; if (ItemClosed) return null; FrameReady.WaitOne((int)Math.Max(1, Math.Min(100, timeoutMs - w.ElapsedMilliseconds))); }
        return null;
    }
    public void Dispose() {
        lock (gate) { if (disposed) return; disposed = true; }
        try { session?.Dispose(); } catch (Exception) { }
        try { pool?.Dispose(); } catch (Exception) { }
        lock (gate) { Native.Release(staging); staging = IntPtr.Zero; queue.Clear(); }
        try { (d3d as IDisposable)?.Dispose(); } catch (Exception) { }
        Native.Release(graphicsDevice); graphicsDevice = IntPtr.Zero; Native.Release(context); context = IntPtr.Zero; Native.Release(device); device = IntPtr.Zero;
    }
}

sealed class CaptureRefused : Exception { public readonly string Code; public CaptureRefused(string code, string reason) : base(reason) { Code = code; } }

static class Program {
    public const string Version = "0.33.0";
    static int Fail(string code, string reason, int exit = 1) { Json.Line("{\"ok\":false,\"backend\":\"windows-graphics-capture\",\"code\":" + Json.Q(code) + ",\"reason\":" + Json.Q(reason) + "}"); return exit; }

    /// <summary>Identity checks mirror the PrintWindow path: a reused handle or a minimised window is refused, never captured.</summary>
    public static void CheckWindow(IntPtr h, int pid) {
        if (!Native.IsWindow(h)) throw new CaptureRefused("target-lost", "The window no longer exists.");
        uint owner; Native.GetWindowThreadProcessId(h, out owner); if (pid != 0 && owner != (uint)pid) throw new CaptureRefused("target-identity-changed", "The handle now belongs to process " + owner + ", not " + pid + ".");
        if (Native.IsIconic(h)) throw new CaptureRefused("target-minimized", "The window is minimised; Windows Graphics Capture produces no frames for it.");
        if (!Native.IsWindowVisible(h)) throw new CaptureRefused("target-lost", "The window is not visible.");
    }

    static int Main(string[] args) {
        AppDomain.CurrentDomain.UnhandledException += (s, e) => { try { Json.Line("{\"ok\":false,\"backend\":\"windows-graphics-capture\",\"code\":\"unexpected-exception\",\"reason\":" + Json.Q(e.ExceptionObject.ToString().Split('\n')[0]) + "}"); } catch (Exception) { } Environment.Exit(4); };
        string hwnd = null, monitor = null, outFile = null, outDir = null; int pid = 0, timeoutMs = 3000, maxLatencyMs = 250, frames = 0, durationMs = 0, queueCap = 4, saveEvery = 0, stallMs = 3000; double fps = 10; bool sessionMode = false, selftest = false, emitPng = false;
        try {
            for (int i = 0; i < args.Length; i++) {
                switch (args[i]) {
                    case "--version": Json.Line("{\"tool\":\"EightMaxWgc\",\"version\":\"" + Version + "\",\"backend\":\"windows-graphics-capture\",\"os\":" + Json.Q(Environment.OSVersion.VersionString) + "}"); return 0;
                    case "--probe": { bool ok; string why = ""; try { ok = GraphicsCaptureSession.IsSupported(); } catch (Exception e) { ok = false; why = e.GetType().Name + ": " + e.Message; } Json.Line("{\"ok\":true,\"tool\":\"EightMaxWgc\",\"version\":\"" + Version + "\",\"backend\":\"windows-graphics-capture\",\"supported\":" + (ok ? "true" : "false") + ",\"os\":" + Json.Q(Environment.OSVersion.VersionString) + ",\"detail\":" + Json.Q(why) + "}"); return ok ? 0 : 3; }
                    case "--hwnd": hwnd = args[++i]; break; case "--monitor": monitor = args[++i]; break; case "--out": outFile = args[++i]; break; case "--out-dir": outDir = args[++i]; break;
                    case "--pid": pid = int.Parse(args[++i]); break; case "--timeout-ms": timeoutMs = int.Parse(args[++i]); break; case "--max-latency-ms": maxLatencyMs = int.Parse(args[++i]); break;
                    case "--session": sessionMode = true; break; case "--emit-png": emitPng = true; break; case "--selftest": selftest = true; break;
                    case "--fps": fps = double.Parse(args[++i], System.Globalization.CultureInfo.InvariantCulture); break; case "--frames": frames = int.Parse(args[++i]); break; case "--duration-ms": durationMs = int.Parse(args[++i]); break;
                    case "--queue": queueCap = int.Parse(args[++i]); break; case "--save-every": saveEvery = int.Parse(args[++i]); break; case "--stall-ms": stallMs = int.Parse(args[++i]); break;
                    default: return Fail("bad-arguments", "Unknown argument " + args[i], 2);
                }
            }
        } catch (Exception e) { return Fail("bad-arguments", e.Message, 2); }
        try {
            if (!GraphicsCaptureSession.IsSupported()) return Fail("unsupported", "Windows Graphics Capture needs Windows 10 version 1903 or later.", 3);
            if (selftest) return SelfTest.Run(outDir ?? ".");
            if ((hwnd == null) == (monitor == null)) return Fail("bad-arguments", "Give exactly one of --hwnd / --monitor.", 2);
            IntPtr h = Native.ParseHandle(hwnd ?? monitor);
            if (hwnd != null) CheckWindow(h, pid);
            if (sessionMode) { if (outDir == null) return Fail("bad-arguments", "--session needs --out-dir.", 2); return RunSession(h, monitor != null, pid, outDir, fps, frames, durationMs, queueCap, saveEvery, stallMs, timeoutMs, emitPng); }
            if (outFile == null) return Fail("bad-arguments", "--out is required.", 2);
            using (var s = new WgcSession(h, monitor != null, pid, 2, 0)) {
                double t0 = s.NowMs; s.Start();
                var f = s.WaitFrame(timeoutMs, null);
                if (f == null) return Fail(s.ItemClosed ? "target-lost" : "no-frame", s.ItemClosed ? "The target closed during capture." : "No frame arrived within " + timeoutMs + " ms (window hidden or protected content).");
                double latency = f.ArrivedMs - t0;
                if (s.Resizes > 0) return Fail("resolution-changed", "The target was resized during capture (" + s.Resizes + " size change(s)); the frame was refused. Capture again.");
                if (latency > maxLatencyMs) return Fail("stale-frame", "First frame took " + Json.N(latency) + " ms (limit " + maxLatencyMs + " ms); refused.");
                if (f.Blank) return Fail("blank-frame", "The captured frame is completely black; refused.");
                Png.WriteBgra(outFile, f.Bgra, f.Width, f.Height);
                double dpi = hwnd != null ? Native.GetDpiForWindow(h) / 96.0 : 0;
                Json.Line("{\"ok\":true,\"backend\":\"windows-graphics-capture\",\"device\":" + Json.Q(s.DeviceKind) + ",\"width\":" + f.Width + ",\"height\":" + f.Height + ",\"dpiScale\":" + Json.N(dpi) + ",\"seq\":" + f.Seq + ",\"latencyMs\":" + Json.N(latency) + ",\"ageMs\":" + Json.N(f.AgeMs) + ",\"systemRelativeTimeMs\":" + Json.N(f.SystemRelativeMs) + ",\"path\":" + Json.Q(outFile) + "}");
                return 0;
            }
        } catch (CaptureRefused r) { return Fail(r.Code, r.Message); }
        catch (Exception e) { return Fail("capture-failed", e.GetType().Name + ": " + e.Message); }
    }

    /// <summary>Persistent session: one WGC session for many frames; JSON line per event; bounded queue; clean stop.</summary>
    static int RunSession(IntPtr h, bool monitor, int pid, string outDir, double fps, int maxFrames, int durationMs, int queueCap, int saveEvery, int stallMs, int firstFrameTimeoutMs, bool emitPng) {
        Directory.CreateDirectory(outDir);
        var stop = new ManualResetEventSlim(false); string endCode = "stopped";
        var stdin = new Thread(() => { try { string line; while ((line = Console.In.ReadLine()) != null) if (line.Trim() == "stop") break; } catch (Exception) { } stop.Set(); }) { IsBackground = true }; stdin.Start();
        var ages = new List<double>(); long delivered = 0; double lastFrameAt; bool minimized = false; long peakWs = 0;
        using (var s = new WgcSession(h, monitor, pid, queueCap, fps)) {
            s.Event += Json.Line;
            double t0 = s.NowMs; s.Start(); lastFrameAt = t0;
            Json.Line("{\"event\":\"started\",\"backend\":\"windows-graphics-capture\",\"device\":" + Json.Q(s.DeviceKind) + ",\"width\":" + s.Size.Width + ",\"height\":" + s.Size.Height + ",\"fps\":" + Json.N(fps) + ",\"queue\":" + queueCap + "}");
            while (!stop.IsSet) {
                if (maxFrames > 0 && delivered >= maxFrames) { endCode = "frame-limit"; break; }
                if (durationMs > 0 && s.NowMs - t0 >= durationMs) { endCode = "duration-limit"; break; }
                if (s.ItemClosed || (!monitor && !Native.IsWindow(h))) { endCode = "target-lost"; Json.Line("{\"event\":\"target-lost\",\"code\":\"target-lost\"}"); break; }
                if (!monitor) { bool icon = Native.IsIconic(h); if (icon != minimized) { minimized = icon; Json.Line("{\"event\":\"" + (icon ? "minimized" : "restored") + "\"}"); lastFrameAt = s.NowMs; } }
                var f = s.WaitFrame(100, null);
                if (f == null) {
                    if (delivered == 0 && s.NowMs - t0 > firstFrameTimeoutMs && !minimized) { endCode = "no-frame"; Json.Line("{\"event\":\"capture-timeout\",\"code\":\"no-frame\",\"afterMs\":" + Json.N(s.NowMs - t0) + "}"); break; }
                    if (!minimized && stallMs > 0 && s.NowMs - lastFrameAt > stallMs) { Json.Line("{\"event\":\"stalled\",\"sinceMs\":" + Json.N(s.NowMs - lastFrameAt) + ",\"note\":\"Windows Graphics Capture only delivers frames when the window content changes.\"}"); lastFrameAt = s.NowMs; }
                    continue;
                }
                delivered++; lastFrameAt = s.NowMs; ages.Add(f.AgeMs);
                string saved = null; if (saveEvery > 0 && f.Seq % saveEvery == 0) { saved = Path.Combine(outDir, "frame-" + f.Seq.ToString("D6") + ".png"); Png.WriteBgra(saved, f.Bgra, f.Width, f.Height); }
                Json.Line("{\"event\":\"frame\",\"seq\":" + f.Seq + ",\"width\":" + f.Width + ",\"height\":" + f.Height + ",\"systemRelativeTimeMs\":" + Json.N(f.SystemRelativeMs) + ",\"ageMs\":" + Json.N(f.AgeMs) + ",\"blank\":" + (f.Blank ? "true" : "false") + (saved != null ? ",\"path\":" + Json.Q(saved) : "") + (emitPng && !f.Blank ? ",\"png\":\"" + Convert.ToBase64String(PngWriter.Encode(f.Bgra, f.Width, f.Height)) + "\"" : "") + "}");
                peakWs = Math.Max(peakWs, Environment.WorkingSet);
            }
            ages.Sort();
            Func<double, double> pct = p => ages.Count == 0 ? 0 : ages[Math.Min(ages.Count - 1, (int)Math.Ceiling(p * ages.Count) - 1)];
            Json.Line("{\"event\":\"summary\",\"end\":" + Json.Q(endCode) + ",\"delivered\":" + delivered + ",\"arrived\":" + s.Arrived + ",\"dropped\":" + s.Dropped + ",\"throttled\":" + s.Throttled + ",\"blank\":" + s.Blank + ",\"resizes\":" + s.Resizes + ",\"ageP50Ms\":" + Json.N(pct(0.5)) + ",\"ageP95Ms\":" + Json.N(pct(0.95)) + ",\"peakWorkingSetMiB\":" + Json.N(peakWs / 1048576.0) + ",\"durationMs\":" + Json.N(s.NowMs - t0) + (s.LastError != null ? ",\"lastError\":" + Json.Q(s.LastError) : "") + "}");
        }
        return endCode == "no-frame" || (endCode == "target-lost" && delivered == 0) ? 1 : 0;
    }
}
}
