// EightMax Test Workbench 0.35.0 - emergency hotkey and manual-override detection for the input driver.
// RegisterHotKey: a documented, system-wide hot key that the operator can always press (default Ctrl+Alt+F12).
// Raw Input (RegisterRawInputDevices, RIDEV_INPUTSINK): reports that a PHYSICAL mouse or keyboard produced input - SendInput
// events carry no device handle - so the driver yields as soon as a person touches the mouse or keyboard. Only the fact
// "a device moved / a key went down" is used; key identities and positions are not recorded. This is not a hook: it cannot
// block, change or delay anybody's input.
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace EightMax.Input {
public sealed class SafetyWindow : NativeWindow {
    [DllImport("user32.dll", SetLastError = true)] static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);
    [StructLayout(LayoutKind.Sequential)] struct RAWINPUTDEVICE { public ushort usUsagePage, usUsage; public uint dwFlags; public IntPtr hwndTarget; }
    [StructLayout(LayoutKind.Sequential)] struct RAWINPUTHEADER { public uint dwType, dwSize; public IntPtr hDevice, wParam; }
    [DllImport("user32.dll", SetLastError = true)] static extern bool RegisterRawInputDevices(RAWINPUTDEVICE[] d, uint n, uint size);
    [DllImport("user32.dll")] static extern uint GetRawInputData(IntPtr h, uint cmd, IntPtr data, ref uint size, uint header);
    const int WM_HOTKEY = 0x0312, WM_INPUT = 0x00FF, HOTKEY_ID = 0x4D45; const uint RIDEV_INPUTSINK = 0x100, RID_INPUT = 0x10000003, RIM_TYPEMOUSE = 0, RIM_TYPEKEYBOARD = 1;
    readonly Driver driver; int moveCounts; long windowStart;
    public SafetyWindow(Driver d) { driver = d; }

    public static uint[] ParseHotkey(string spec) {
        uint mods = 0x4000 /*MOD_NOREPEAT*/, vk = 0; foreach (string raw in spec.Split('+')) { string p = raw.Trim().ToLowerInvariant();
            if (p == "ctrl" || p == "control") mods |= 2; else if (p == "alt") mods |= 1; else if (p == "shift") mods |= 4; else if (p == "win") mods |= 8;
            else if (p.Length >= 2 && p[0] == 'f') { int n; if (Int32.TryParse(p.Substring(1), out n) && n >= 1 && n <= 24) vk = (uint)(0x6F + n); }
            else if (p == "pause") vk = 0x13; else if (p == "scrolllock") vk = 0x91; else if (p == "end") vk = 0x23; else if (p.Length == 1 && (p[0] >= 'a' && p[0] <= 'z' || p[0] >= '0' && p[0] <= '9')) vk = (uint)Char.ToUpperInvariant(p[0]); }
        if (vk == 0 || (mods & 0xF) == 0) throw new DriverError("bad-hotkey", "The emergency-stop hotkey needs at least one of Ctrl/Alt/Shift/Win and a key, e.g. Ctrl+Alt+F12."); return new uint[] { mods, vk };
    }
    /// <summary>Creates the hidden window and runs its message loop on a dedicated STA thread.</summary>
    public static Thread Start(Driver d, string hotkey) {
        ManualResetEvent ready = new ManualResetEvent(false);
        Thread th = new Thread(delegate() {
            SafetyWindow w = new SafetyWindow(d); CreateParams cp = new CreateParams(); cp.Caption = "EightMax input driver safety"; cp.Style = unchecked((int)0x80000000) /*WS_POPUP*/; w.CreateHandle(cp);
            try { uint[] hk = ParseHotkey(hotkey); d.HotkeySpec = hotkey; d.HotkeyRegistered = RegisterHotKey(w.Handle, HOTKEY_ID, hk[0], hk[1]); if (!d.HotkeyRegistered) d.SafetyNote += "Hotkey " + hotkey + " is in use by another program (error " + Marshal.GetLastWin32Error() + "); choose another. "; }
            catch (DriverError e) { d.SafetyNote += e.Message + " "; }
            RAWINPUTDEVICE[] devs = new RAWINPUTDEVICE[2]; devs[0].usUsagePage = 1; devs[0].usUsage = 2; devs[0].dwFlags = RIDEV_INPUTSINK; devs[0].hwndTarget = w.Handle; devs[1].usUsagePage = 1; devs[1].usUsage = 6; devs[1].dwFlags = RIDEV_INPUTSINK; devs[1].hwndTarget = w.Handle;
            d.RawInputActive = RegisterRawInputDevices(devs, 2, (uint)Marshal.SizeOf(typeof(RAWINPUTDEVICE)));
            if (!d.RawInputActive) d.SafetyNote += "Raw Input unavailable; manual override falls back to cursor-position checks. ";
            ready.Set(); Application.Run(); try { UnregisterHotKey(w.Handle, HOTKEY_ID); } catch (Exception) { } w.DestroyHandle();
        });
        th.IsBackground = true; th.SetApartmentState(ApartmentState.STA); th.Name = "input-safety"; th.Start(); ready.WaitOne(5000); return th;
    }
    protected override void WndProc(ref Message m) {
        if (m.Msg == WM_HOTKEY && m.WParam.ToInt32() == HOTKEY_ID) { driver.EmergencyStop("hotkey " + driver.HotkeySpec); return; }
        if (m.Msg == WM_INPUT) {
            uint size = 0, hs = (uint)Marshal.SizeOf(typeof(RAWINPUTHEADER)); GetRawInputData(m.LParam, RID_INPUT, IntPtr.Zero, ref size, hs);
            if (size >= hs && size < 4096) { IntPtr buf = Marshal.AllocHGlobal((int)size);
                try { if (GetRawInputData(m.LParam, RID_INPUT, buf, ref size, hs) == size) { RAWINPUTHEADER h = (RAWINPUTHEADER)Marshal.PtrToStructure(buf, typeof(RAWINPUTHEADER));
                    if (h.hDevice != IntPtr.Zero) {   // physical device; SendInput events have no device handle
                        if (h.dwType == RIM_TYPEKEYBOARD) driver.PhysicalInput("keyboard");
                        else if (h.dwType == RIM_TYPEMOUSE) { long now = driver.Platform.Ticks(); if (now - windowStart > 250) { windowStart = now; moveCounts = 0; } if (++moveCounts >= 3) driver.PhysicalInput("mouse"); } } } }
                finally { Marshal.FreeHGlobal(buf); } }
        }
        base.WndProc(ref m);
    }
}
}
