/* EightMax Test Workbench 0.35.0: COORDINATES for visible input (platform independent).
 *
 * Profiles store control regions as fractions (0..1) of the simulator's CLIENT area. At action time they are converted with the
 * window's CURRENT client rectangle in physical screen pixels (the input driver and capture are per-monitor DPI aware, so
 * 150 % scaling, 4K and windows on any monitor of a multi-monitor desktop all use the same physical pixel space; negative
 * coordinates on monitors left of / above the primary are normal). Nothing is cached across a move or resize: a click target
 * is always computed from the rectangle the driver reports right now, and the driver refuses the click if that rectangle
 * changed in between ("layout-changed").
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WorkbenchInputGeometry = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const isBox = (b) => b && ['x', 'y', 'w', 'h'].every((k) => finite(b[k]));
  function validNormalized(b) { return isBox(b) && b.x >= 0 && b.y >= 0 && b.w > 0 && b.h > 0 && b.x + b.w <= 1 + 1e-9 && b.y + b.h <= 1 + 1e-9; }
  function validClient(c) { return c && ['x', 'y', 'w', 'h'].every((k) => Number.isInteger(c[k])) && c.w >= 160 && c.h >= 100 && c.w <= 16384 && c.h <= 16384; }

  /**
   * Normalised region -> physical screen rectangle and a click point.
   * The rectangle is shrunk by `insetFraction` on each side (at least 2 px) so a click never lands on a control's border;
   * the point is the centre of what remains. Refuses regions smaller than `minSizePx` after the inset.
   */
  function regionToScreen(box, client, o = {}) {
    if (!validNormalized(box)) return { ok: false, reason: 'control region must be inside 0..1 with positive size' };
    if (!validClient(client)) return { ok: false, reason: 'window client rectangle invalid or too small' };
    const inset = o.insetFraction === undefined ? 0.18 : o.insetFraction, minPx = o.minSizePx || 6;
    const x0 = client.x + box.x * client.w, y0 = client.y + box.y * client.h, w = box.w * client.w, h = box.h * client.h;
    const ix = Math.max(2, w * inset), iy = Math.max(2, h * inset);
    const L = Math.ceil(x0 + ix), T = Math.ceil(y0 + iy), R = Math.floor(x0 + w - ix), B = Math.floor(y0 + h - iy);
    const rect = { x: L, y: T, w: R - L, h: B - T };
    if (rect.w < minPx || rect.h < minPx) return { ok: false, reason: 'control is only ' + Math.round(w) + 'x' + Math.round(h) + ' px at this window size; too small to click reliably' };
    const point = { x: Math.floor(L + rect.w / 2), y: Math.floor(T + rect.h / 2) };
    return { ok: true, rect, point, full: { x: Math.floor(x0), y: Math.floor(y0), w: Math.round(w), h: Math.round(h) } };
  }
  /** Screen point -> normalised client coordinate (calibration). */
  function screenToNormalized(pt, client) { return { x: (pt.x - client.x) / client.w, y: (pt.y - client.y) / client.h }; }
  /**
   * A captured image's pixel rectangle -> normalised box. With a DPI-aware capture the image IS the client area at physical size;
   * when the sizes differ (a DPI-unaware capture or a scaled preview) the image is scaled to the client.
   */
  function imageRectToNormalized(r, image) { return { x: r.x / image.width, y: r.y / image.height, w: r.w / image.width, h: r.h / image.height }; }
  /** Does the capture describe the same client rectangle the driver reports now? (size compared in physical pixels.) */
  function sameLayout(captureBounds, client, tolerancePx = 0) {
    if (!captureBounds || !client) return false;
    return Math.abs(captureBounds.x - client.x) <= tolerancePx && Math.abs(captureBounds.y - client.y) <= tolerancePx && Math.abs(captureBounds.width - client.w) <= tolerancePx && Math.abs(captureBounds.height - client.h) <= tolerancePx;
  }
  /** Logical (DPI-scaled) -> physical, for documentation and tests: physical = round(logical * scale). */
  const logicalToPhysical = (v, scale) => Math.round(v * scale);
  /** Which monitor contains a point (multi-monitor; negative coordinates allowed). */
  function monitorAt(monitors, pt) { return (monitors || []).find((m) => pt.x >= m.bounds.x && pt.y >= m.bounds.y && pt.x < m.bounds.x + m.bounds.w && pt.y < m.bounds.y + m.bounds.h) || null; }
  /** Overlap test for calibration: two normalised boxes. */
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  return { validNormalized, validClient, regionToScreen, screenToNormalized, imageRectToNormalized, sameLayout, logicalToPhysical, monitorAt, overlaps };
});
