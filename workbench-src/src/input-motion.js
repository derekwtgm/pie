/* EightMax Test Workbench 0.35.0: cursor MOTION model and movement VALIDATION (platform independent).
 *
 * Mirrors desktop/input/Motion.cs exactly (same formulas, same constants) so the scheduler can estimate how long a visible
 * movement takes before it asks the driver, and so tests can check what the driver reports.
 *   position profile  s(u) = 10u^3 - 15u^4 + 6u^5   (minimum jerk: zero speed and zero acceleration at both ends)
 *   duration          the shortest that respects max speed, max acceleration and a minimum duration - never shorter
 * Validation measures a recorded path (driver step log or an independent cursor sampler) for continuity, speed, acceleration,
 * update intervals, endpoint accuracy and button activity. It measures UI reliability only; nothing here imitates a person.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WorkbenchInputMotion = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PEAK_V = 1.875, PEAK_A = 10 / Math.sqrt(3);
  /** Conservative defaults for visible UI testing (physical pixels). Starting points for testing, not human characteristics. */
  const DEFAULT_PROFILE = Object.freeze({ maxSpeed: 1600, maxAccel: 9000, minDurationMs: 140, intervalMs: 16, arc: 0, maxDurationMs: 4000 });
  /** Click / keyboard timing defaults (milliseconds). */
  const DEFAULT_TIMING = Object.freeze({ preClickMs: 60, holdMs: 70, postClickSettleMs: 150, keyIntervalMs: 45, keyHoldMs: 12, focusSettleMs: 80, postActionTimeoutMs: 3000 });
  const LIMITS = Object.freeze({ maxSpeed: [50, 20000], maxAccel: [200, 400000], minDurationMs: [0, 5000], intervalMs: [4, 100], arc: [0, 0.25], maxDurationMs: [50, 20000] });

  function profile(p = {}) {
    const out = { ...DEFAULT_PROFILE };
    for (const k of Object.keys(p)) {
      if (!(k in LIMITS)) throw new Error('Unknown motion setting ' + k);
      const v = Number(p[k]); if (!Number.isFinite(v) || v < LIMITS[k][0] || v > LIMITS[k][1]) throw new Error('Motion setting ' + k + ' must be between ' + LIMITS[k][0] + ' and ' + LIMITS[k][1]);
      out[k] = v;
    }
    return out;
  }
  const s = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (10 + u * (-15 + 6 * u)));
  const velocityFactor = (arc) => PEAK_V * Math.sqrt(1 + 16 * arc * arc);
  const accelFactor = (arc) => 8 * arc * PEAK_V * PEAK_V + PEAK_A * Math.sqrt(1 + 16 * arc * arc);
  function durationMs(distance, p = DEFAULT_PROFILE) {
    if (!(distance > 0.5)) return 0;
    const tv = velocityFactor(p.arc) * distance / p.maxSpeed, ta = Math.sqrt(accelFactor(p.arc) * distance / p.maxAccel);
    return Math.max(p.minDurationMs, 1000 * Math.max(tv, ta));
  }
  const steps = (ms, p = DEFAULT_PROFILE) => (ms <= 0 ? 0 : Math.max(2, Math.ceil(ms / p.intervalMs)));
  function at(x0, y0, x1, y1, u, arc = 0) {
    const k = s(u), dx = x1 - x0, dy = y1 - y0; let x = x0 + dx * k, y = y0 + dy * k;
    if (arc > 0) { const bow = 4 * k * (1 - k) * arc; x += -dy * bow; y += dx * bow; }
    return { x, y };
  }
  /** The path the driver will command (integer pixels, last point exactly on target), with the planned timestamps. */
  function plan(from, to, p = DEFAULT_PROFILE) {
    const d = Math.hypot(to.x - from.x, to.y - from.y), ms = durationMs(d, p), n = steps(ms, p), pts = [];
    for (let k = 1; k <= n; k++) { const q = at(from.x, from.y, to.x, to.y, k / n, p.arc); pts.push({ t: ms * k / n, x: k === n ? to.x : Math.round(q.x), y: k === n ? to.y : Math.round(q.y) }); }
    return { distance: d, durationMs: ms, steps: n, peakSpeed: n ? velocityFactor(p.arc) * d / (ms / 1000) : 0, peakAccel: n ? accelFactor(p.arc) * d / Math.pow(ms / 1000, 2) : 0, points: pts };
  }

  /**
   * Analyse a sampled path [{t (ms), x, y, down?}] against a profile and a target region.
   * Speeds/accelerations of integer-pixel samples include rounding noise (0.5 px per sample); accelerations are therefore
   * measured over three-sample windows and compared with a stated quantisation allowance, reported separately.
   */
  function analyse(samples, o = {}) {
    const p = o.profile || DEFAULT_PROFILE, pts = (samples || []).filter((q) => Number.isFinite(q.t) && Number.isFinite(q.x) && Number.isFinite(q.y));
    const r = { samples: pts.length, ok: false, problems: [] };
    if (pts.length < 2) { r.problems.push('fewer than two samples'); return r; }
    let travel = 0, maxStep = 0, maxDt = 0, minDt = Infinity, peakV = 0, peakA = 0, downs = 0; const dts = [], v = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], dt = b.t - a.t, ds = Math.hypot(b.x - a.x, b.y - a.y); travel += ds; maxStep = Math.max(maxStep, ds);
      if (dt > 0) { dts.push(dt); maxDt = Math.max(maxDt, dt); minDt = Math.min(minDt, dt); v.push({ t: (a.t + b.t) / 2, vx: (b.x - a.x) / dt * 1000, vy: (b.y - a.y) / dt * 1000, dt }); }
    }
    for (const q of v) peakV = Math.max(peakV, Math.hypot(q.vx, q.vy));
    for (let i = 2; i < v.length; i++) { const a = v[i - 2], b = v[i], dt = (b.t - a.t) / 1000; if (dt > 0) peakA = Math.max(peakA, Math.hypot(b.vx - a.vx, b.vy - a.vy) / dt); }
    for (const q of pts) if (q.down) downs++;
    const first = pts[0], last = pts[pts.length - 1], duration = last.t - first.t, sorted = dts.slice().sort((x, y) => x - y), med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
    const meanDt = sorted.length ? sorted.reduce((x, y) => x + y, 0) / sorted.length : null;
    Object.assign(r, { start: { x: first.x, y: first.y }, end: { x: last.x, y: last.y }, travel: +travel.toFixed(2), durationMs: +duration.toFixed(2), peakSpeed: +peakV.toFixed(1), peakAccel: +peakA.toFixed(1), maxStepPx: +maxStep.toFixed(2),
      intervalMs: { min: Number.isFinite(minDt) ? +minDt.toFixed(2) : null, median: med === null ? null : +med.toFixed(2), mean: meanDt === null ? null : +meanDt.toFixed(2), max: +maxDt.toFixed(2) }, buttonDownSamples: downs });
    // Allowances: rounding to whole pixels adds up to 1 px per interval of speed noise and 2 px per interval^2 of acceleration noise.
    const typDt = (med || p.intervalMs) / 1000, vAllow = p.maxSpeed * 1.08 + 1 / typDt, aAllow = p.maxAccel * 1.25 + 2 / (typDt * typDt);
    r.allowance = { speed: +vAllow.toFixed(1), accel: +aAllow.toFixed(1), note: 'limit x1.08 (+1 px per interval) for speed and x1.25 (+2 px per interval^2) for acceleration: integer-pixel quantisation and timer jitter' };
    const jumpLimit = o.maxStepPx !== undefined ? o.maxStepPx : Math.max(8, p.maxSpeed * (maxDt / 1000) * 1.2 + 2);
    if (maxStep > jumpLimit) r.problems.push('discontinuity: a ' + maxStep.toFixed(1) + ' px jump between samples (limit ' + jumpLimit.toFixed(1) + ' px)');
    if (o.checkLimits !== false) { if (peakV > vAllow) r.problems.push('speed ' + peakV.toFixed(0) + ' px/s exceeds ' + vAllow.toFixed(0)); if (peakA > aAllow) r.problems.push('acceleration ' + peakA.toFixed(0) + ' px/s^2 exceeds ' + aAllow.toFixed(0)); }
    if (o.target) { r.targetError = +Math.hypot(last.x - o.target.x, last.y - o.target.y).toFixed(2); if (r.targetError > (o.targetTolerancePx || 0)) r.problems.push('ended ' + r.targetError + ' px from the target'); }
    if (o.region) { const g = o.region, inside = last.x >= g.x && last.y >= g.y && last.x < g.x + g.w && last.y < g.y + g.h; r.endsInRegion = inside; if (!inside) r.problems.push('ended outside the validated control region'); }
    if (o.expectNoButton && downs) r.problems.push(downs + ' samples with the mouse button down during a movement');
    r.ok = r.problems.length === 0; return r;
  }
  /** After a cancel: the cursor must not move again (samples taken after cancelAt). */
  function movedAfter(samples, tMs, tolerancePx = 0) {
    const after = samples.filter((q) => q.t >= tMs); if (after.length < 2) return { moved: false, samples: after.length };
    let maxD = 0; for (const q of after) maxD = Math.max(maxD, Math.hypot(q.x - after[0].x, q.y - after[0].y)); return { moved: maxD > tolerancePx, maxDisplacement: maxD, samples: after.length };
  }
  /** Cursor-monitor rows from the driver are [t*10, x, y, down]. */
  const fromMonitor = (rows) => rows.map((r) => ({ t: r[0] / 10, x: r[1], y: r[2], down: r[3] === 1 }));

  return { DEFAULT_PROFILE, DEFAULT_TIMING, LIMITS, profile, s, durationMs, steps, at, plan, analyse, movedAfter, fromMonitor, velocityFactor, accelFactor };
});
