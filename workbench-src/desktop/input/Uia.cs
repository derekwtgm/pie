// EightMax Test Workbench 0.35.0 - Windows UI Automation helpers (compiled on Windows with /define:UIA and the
// UIAutomationClient/UIAutomationTypes references; without them the driver reports uiAutomation: false and uses WM_GETTEXT).
// Used read-only: list the standard Button/Edit controls of a registered window (calibration suggestions) and read the
// value of the focused field (wager verification). Never invokes patterns, never sets values - all input goes through SendInput.
using System;
using System.Collections.Generic;

namespace EightMax.Input {
public static class Uia {
#if UIA
    public static bool Available { get { return true; } }
    public static object FocusedValue() {
        try { System.Windows.Automation.AutomationElement e = System.Windows.Automation.AutomationElement.FocusedElement; if (e == null) return null; object p;
            if (e.TryGetCurrentPattern(System.Windows.Automation.ValuePattern.Pattern, out p)) return ((System.Windows.Automation.ValuePattern)p).Current.Value; return null; }
        catch (Exception) { return null; }
    }
    public static List<object> Controls(long hwnd) {
        List<object> list = new List<object>();
        try {
            System.Windows.Automation.AutomationElement root = System.Windows.Automation.AutomationElement.FromHandle(new IntPtr(hwnd));
            System.Windows.Automation.Condition c = new System.Windows.Automation.OrCondition(
                new System.Windows.Automation.PropertyCondition(System.Windows.Automation.AutomationElement.ControlTypeProperty, System.Windows.Automation.ControlType.Button),
                new System.Windows.Automation.PropertyCondition(System.Windows.Automation.AutomationElement.ControlTypeProperty, System.Windows.Automation.ControlType.Edit));
            foreach (System.Windows.Automation.AutomationElement e in root.FindAll(System.Windows.Automation.TreeScope.Descendants, c)) {
                if (list.Count >= 64) break; System.Windows.Rect b = e.Current.BoundingRectangle; if (b.IsEmpty) continue;
                Dictionary<string, object> d = new Dictionary<string, object>(); d["name"] = e.Current.Name; d["automationId"] = e.Current.AutomationId; d["type"] = e.Current.ControlType.ProgrammaticName.Replace("ControlType.", "");
                d["enabled"] = e.Current.IsEnabled; d["box"] = Json.Box(new Rect((int)b.X, (int)b.Y, (int)b.Width, (int)b.Height)); d["hwnd"] = Json.Hex(e.Current.NativeWindowHandle); list.Add(d);
            }
        } catch (Exception) { }
        return list;
    }
#else
    public static bool Available { get { return false; } }
    public static object FocusedValue() { return null; }
    public static List<object> Controls(long hwnd) { return new List<object>(); }
#endif
}
}
