// EightMax Test Workbench 0.35.0 - cursor motion planning for the Windows input driver.
// Minimum-jerk (quintic smoothstep) position profile s(u) = 10u^3 - 15u^4 + 6u^5, u in [0,1]:
//   * zero velocity AND zero acceleration at both ends (no abrupt start/stop, no acceleration step);
//   * peak speed 1.875 D/T at u = 0.5, peak |acceleration| (10/sqrt 3) D/T^2 at u = (3 -/+ sqrt 3)/6.
// The duration is the SHORTEST that respects every configured limit, never shorter: speed, acceleration and a minimum
// duration. A deadline never shortens a movement (the scheduler rejects an action instead).
// Optional "arc" path: a deterministic sideways bow of arc*D at mid-path (for routing around a control); default 0 = straight.
// Nothing here is random: the same command always produces the same path. This is for visible, reviewable UI testing,
// not to imitate a person.
using System;
using System.Collections.Generic;

namespace EightMax.Input {
public sealed class MotionProfile {
    public double MaxSpeed = 1600;        // px/s (physical pixels)
    public double MaxAccel = 9000;        // px/s^2
    public double MinDurationMs = 140;    // even a tiny move is visible for this long
    public double IntervalMs = 16;        // update period (about 60 per second)
    public double Arc = 0;                // 0 = straight; 0..0.25 sideways bow as a fraction of the distance
    public double MaxDurationMs = 4000;   // planning refuses (does not speed up) beyond this
    public static MotionProfile From(Dictionary<string, object> d) {
        MotionProfile p = new MotionProfile(); if (d == null) return p;
        p.MaxSpeed = Num(d, "maxSpeed", p.MaxSpeed, 50, 20000); p.MaxAccel = Num(d, "maxAccel", p.MaxAccel, 200, 400000);
        p.MinDurationMs = Num(d, "minDurationMs", p.MinDurationMs, 0, 5000); p.IntervalMs = Num(d, "intervalMs", p.IntervalMs, 4, 100);
        p.Arc = Num(d, "arc", p.Arc, 0, 0.25); p.MaxDurationMs = Num(d, "maxDurationMs", p.MaxDurationMs, 50, 20000);
        return p;
    }
    static double Num(Dictionary<string, object> d, string k, double def, double lo, double hi) {
        object v; if (!d.TryGetValue(k, out v) || v == null) return def;
        double x = Convert.ToDouble(v, System.Globalization.CultureInfo.InvariantCulture);
        if (Double.IsNaN(x) || Double.IsInfinity(x) || x < lo || x > hi) throw new DriverError("bad-motion", "Motion setting " + k + " must be between " + lo + " and " + hi + ".");
        return x;
    }
}

public struct PathPoint { public double U, X, Y; }

public static class Motion {
    public const double PeakVelocityFactor = 1.875, PeakAccelFactor = 5.773502691896258; // 10/sqrt(3)
    public static double S(double u) { if (u <= 0) return 0; if (u >= 1) return 1; return u * u * u * (10 + u * (-15 + 6 * u)); }
    // Path P(s) = A + s*D + 4 s(1-s) arc * perp(D):  |P'(s)| <= |D| sqrt(1 + 16 arc^2),  |P''(s)| = 8 arc |D|.
    // Speed |P'| s' <= |D| sqrt(1+16a^2) * 1.875/T.  Acceleration |P'' s'^2 + P' s''| <= |D| (8a * 1.875^2 + sqrt(1+16a^2) * 10/sqrt3) / T^2.
    public static double VelocityFactor(double arc) { return PeakVelocityFactor * Math.Sqrt(1 + 16 * arc * arc); }
    public static double AccelFactor(double arc) { return 8 * arc * PeakVelocityFactor * PeakVelocityFactor + PeakAccelFactor * Math.Sqrt(1 + 16 * arc * arc); }
    public static double DurationMs(double distance, MotionProfile p) {
        if (distance <= 0.5) return 0;
        double tv = VelocityFactor(p.Arc) * distance / p.MaxSpeed, ta = Math.Sqrt(AccelFactor(p.Arc) * distance / p.MaxAccel);
        return Math.Max(p.MinDurationMs, 1000 * Math.Max(tv, ta));
    }
    public static int Steps(double durationMs, MotionProfile p) { return durationMs <= 0 ? 0 : Math.Max(2, (int)Math.Ceiling(durationMs / p.IntervalMs)); }
    /// <summary>Position at fraction u of the duration. Arc bows to the left of the travel direction.</summary>
    public static PathPoint At(double x0, double y0, double x1, double y1, double u, double arc) {
        double s = S(u), dx = x1 - x0, dy = y1 - y0;
        PathPoint p = new PathPoint(); p.U = u; p.X = x0 + dx * s; p.Y = y0 + dy * s;
        if (arc > 0) { double bow = 4 * s * (1 - s) * arc; p.X += -dy * bow; p.Y += dx * bow; }
        return p;
    }
}
}
