/* EightMax Test Workbench 0.24: screen-capture pipeline (platform-independent half).
 *
 * This module owns everything that is the same on every platform: frame sequencing and timestamps,
 * validation, stale / lost / minimised / occluded / resized detection, interruption recovery, bounded
 * debug recording, geometry (monitors, DPI, regions) and the source interface. The Windows half
 * (window enumeration and pixel capture through documented GDI/DWM calls) lives in
 * desktop/CaptureService.cs and is reached through HostCaptureSource.
 *
 * Rules: capture is only ever started by an explicit operator action naming a window or region; a failed
 * capture is reported as a failure and the previous frame is NEVER handed on as if it were new; nothing
 * here touches another process's memory, injects code or hides itself from the application it observes.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./image-codec.js'));
  else root.WorkbenchCapture = factory(root.WorkbenchImageCodec);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (IC) {
  'use strict';

  const ok = (x, m) => { if (!x) throw new Error(m); };
  const mono = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const CODES = Object.freeze({
    OK: 'ok', FAILED: 'capture-failed', LOST: 'target-lost', MINIMIZED: 'target-minimized', OCCLUDED: 'target-occluded',
    RESIZING: 'resolution-settling', STALE: 'stale-frame', INVALID: 'invalid-frame', CLOCK: 'timestamp-regressed', IDENTITY: 'target-identity-changed', OFFSCREEN: 'region-offscreen',
  });

  /* ---------- geometry: monitors, DPI, regions ---------- */
  /** monitor = {id, x, y, width, height, dpiScale (1 = 96 dpi), primary}. Coordinates are physical pixels of the virtual desktop; x/y may be negative. */
  function validateMonitors(monitors) {
    ok(Array.isArray(monitors) && monitors.length >= 1 && monitors.length <= 16, 'Between 1 and 16 monitors expected');
    const seen = new Set();
    for (const m of monitors) {
      ok(Number.isInteger(m.x) && Number.isInteger(m.y) && Number.isInteger(m.width) && Number.isInteger(m.height) && m.width > 0 && m.height > 0, 'Monitor geometry invalid');
      ok(Number.isFinite(m.dpiScale) && m.dpiScale >= 0.5 && m.dpiScale <= 6, 'Monitor DPI scale invalid');
      ok(!seen.has(m.id), 'Duplicate monitor id'); seen.add(m.id);
    }
    return monitors;
  }
  const inter = (a, b) => { const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.width, b.x + b.width), y1 = Math.min(a.y + a.height, b.y + b.height); return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null; };
  /** A region is accepted only if every pixel lies on a monitor. Returns which monitors it touches and warns on mixed DPI. */
  function resolveRegion(region, monitors) {
    validateMonitors(monitors);
    ok(region && Number.isInteger(region.x) && Number.isInteger(region.y) && Number.isInteger(region.width) && Number.isInteger(region.height) && region.width >= 16 && region.height >= 16, 'Region must be integer physical pixels, at least 16x16');
    let covered = 0; const touched = [];
    for (const m of monitors) { const i = inter(region, m); if (i) { covered += i.width * i.height; touched.push(m); } }
    const area = region.width * region.height, warnings = [];
    if (covered < area) return { ok: false, code: CODES.OFFSCREEN, reason: 'Region extends beyond the visible desktop (' + Math.round(100 * covered / area) + '% on screen)', monitors: touched };
    if (touched.length > 1 && new Set(touched.map((m) => m.dpiScale)).size > 1) warnings.push('spans-monitors-mixed-dpi');
    if (touched.length > 1) warnings.push('spans-multiple-monitors');
    return { ok: true, monitors: touched, dpiScale: touched[0].dpiScale, warnings };
  }
  /** Logical (DPI-scaled, as a non-aware app reports) -> physical pixels. */
  const logicalToPhysical = (v, scale) => Math.round(v * scale);

  /* ---------- sources ---------- */
  /** Every source implements: async open(), async grab() -> {ok, image, meta} | {ok:false, code, reason}, async close(). */
  class ImageSequenceSource {
    constructor(frames, options = {}) { this.frames = frames; this.i = 0; this.loop = !!options.loop; this.kind = 'image-sequence'; this.target = { kind: 'file-sequence', title: options.title || 'recorded frames' }; this.method = 'file'; this.clock = options.clock || mono; this.t = 0; }
    async open() { return { ok: true }; }
    async grab() {
      if (this.i >= this.frames.length) { if (!this.loop) return { ok: false, code: CODES.LOST, reason: 'End of recorded sequence' }; this.i = 0; }
      const f = this.frames[this.i++], image = f.image || f;
      return { ok: true, image, meta: { method: 'file', dpiScale: f.dpiScale || 1, sourceTimeMs: f.timeMs === undefined ? this.clock() : f.timeMs, minimized: false, occludedFraction: 0, target: this.target } };
    }
    async close() { return { ok: true }; }
  }

  /**
   * A controlled stand-in for a window on screen, used by tests and the offline client: renders through
   * `render()` at the current client size and can be resized, moved, minimised, occluded, lost or frozen.
   * It reproduces failure MODES; it is not a real capture API and results from it are "simulated window" results.
   */
  class SimulatedWindowSource {
    constructor(render, options = {}) {
      this.kind = 'simulated-window'; this.render = render; this.width = options.width || 960; this.dpiScale = options.dpiScale || 1;
      this.clock = options.clock || mono; this.target = { kind: 'window', hwnd: options.hwnd || 0x1001, pid: options.pid || 4242, title: options.title || 'EightMax controlled client — table 1' };
      this.method = options.method || 'print-window'; this.state = { minimized: false, lost: false, frozen: false, occludedFraction: 0, x: 100, y: 100, failNext: 0 };
      this.frameId = 0; this.last = null; this.opened = false;
    }
    resize(width) { this.width = width; } moveTo(x, y) { this.state.x = x; this.state.y = y; }
    setDpiScale(s) { this.dpiScale = s; }
    set(partial) { Object.assign(this.state, partial); }
    async open() { if (this.state.lost) return { ok: false, code: CODES.LOST, reason: 'Window not found' }; this.opened = true; return { ok: true }; }
    async grab() {
      const s = this.state;
      if (s.failNext > 0) { s.failNext--; return { ok: false, code: CODES.FAILED, reason: 'Injected capture failure' }; }
      if (s.lost) return { ok: false, code: CODES.LOST, reason: 'Target window no longer exists' };
      if (s.minimized) return { ok: false, code: CODES.MINIMIZED, reason: 'Target window is minimised; no pixels are available', meta: { minimized: true } };
      if (!s.frozen || !this.last) { this.last = this.render(this.width, this.frameId + 1); if (!s.frozen) this.frameId++; }
      return { ok: true, image: this.last, meta: { method: this.method, dpiScale: this.dpiScale, sourceFrameId: s.frozen ? this.frameId : this.frameId, sourceTimeMs: s.frozen ? (this._frozenAt || (this._frozenAt = this.clock())) : this.clock(), minimized: false, occludedFraction: s.occludedFraction, bounds: { x: s.x, y: s.y, width: this.last.width, height: this.last.height }, viewSeat: this.last.viewSeat, clientRevision: this.last.clientRevision, target: { ...this.target } } };
    }
    freeze() { this.state.frozen = true; this._frozenAt = this.clock(); } unfreeze() { this.state.frozen = false; this._frozenAt = null; }
    async close() { this.opened = false; return { ok: true }; }
  }

  /**
   * Windows capture through the local desktop host (desktop/CaptureService.cs). `request(method, path, body)` must
   * carry the host's session token; it returns parsed JSON. `decode(base64Png)` -> image (Node: codec; browser: canvas).
   */
  class HostCaptureSource {
    constructor({ request, decode, target, clock }) {
      ok(typeof request === 'function', 'request() is required'); ok(target && (target.kind === 'window' || target.kind === 'region'), 'An explicit capture target is required');
      this.kind = 'windows-host'; this.request = request; this.decode = decode || ((b64) => IC.decodeAny(Buffer.from(b64, 'base64'))); this.target = target; this.clock = clock || mono; this.method = 'host';
    }
    async open() {
      const r = await this.request('POST', '/api/capture/open', { target: this.target });
      if (!r || r.ok !== true) return { ok: false, code: r && r.code || CODES.FAILED, reason: r && r.reason || 'Host refused the capture target' };
      this.target = { ...this.target, ...(r.target || {}) }; this.method = r.method || this.method; return { ok: true };
    }
    async grab() {
      let r; try { r = await this.request('POST', '/api/capture/frame', { target: this.target }); } catch (e) { return { ok: false, code: CODES.FAILED, reason: 'Host request failed: ' + e.message }; }
      if (!r || r.ok !== true) return { ok: false, code: r && r.code || CODES.FAILED, reason: r && r.reason || 'Host returned no frame', meta: r && { minimized: !!r.minimized } };
      let image; try { image = await this.decode(r.png); } catch (e) { return { ok: false, code: CODES.INVALID, reason: 'Frame did not decode: ' + e.message }; }
      if (image.width !== r.width || image.height !== r.height) return { ok: false, code: CODES.INVALID, reason: 'Decoded size ' + image.width + 'x' + image.height + ' disagrees with the host-reported ' + r.width + 'x' + r.height };
      return { ok: true, image, meta: { method: r.method, dpiScale: r.dpiScale, sourceFrameId: r.frameId, sourceTimeMs: r.hostTimeMs, ageMs: r.ageMs, minimized: !!r.minimized, occludedFraction: r.occludedFraction || 0, cloaked: !!r.cloaked, bounds: r.bounds, target: r.target || this.target } };
    }
    async close() { try { await this.request('POST', '/api/capture/close', { target: this.target }); } catch (e) { /* host may already be gone */ } return { ok: true }; }
  }

  /* ---------- recorder (bounded, debugging only; off unless asked for) ---------- */
  class FrameRecorder {
    /** sink(name, bytes) persists a file; index is kept in memory and written with writeIndex(). */
    constructor({ sink, maxFrames = 200, maxBytes = 256 * 1024 * 1024, every = 1, encode }) { this.sink = sink; this.max = maxFrames; this.maxBytes = maxBytes; this.every = every; this.encode = encode || ((img) => IC.encodePng(img)); this.index = []; this.bytes = 0; this.dropped = 0; this.n = 0; }
    record(frame) {
      this.n++;
      if ((this.n - 1) % this.every !== 0) return false;
      if (this.index.length >= this.max) { this.dropped++; return false; }
      const png = this.encode(frame.image);
      if (this.bytes + png.length > this.maxBytes) { this.dropped++; return false; }
      const name = 'frame-' + String(frame.seq).padStart(6, '0') + '.png';
      this.sink(name, png); this.bytes += png.length;
      this.index.push({ file: name, seq: frame.seq, tMs: frame.tMs, width: frame.width, height: frame.height, hash: frame.hash, valid: frame.valid, code: frame.code });
      return true;
    }
    writeIndex() { const body = { format: 'eightmax-capture-recording', version: 1, frames: this.index, dropped: this.dropped, bytes: this.bytes }; this.sink('index.json', Buffer.from(JSON.stringify(body, null, 1))); return body; }
  }

  /* ---------- session ---------- */
  const DEFAULTS = Object.freeze({
    intervalMs: 250, maxFrameAgeMs: 1000, settleFrames: 2, failuresBeforeInterrupted: 3, recoveryGoodFrames: 2, retryBackoffMs: 100, retryBackoffMaxMs: 2000,
    maxOccludedFraction: 0, minWidth: 320, minHeight: 200, requireSourceTimeAdvance: false, rejectBlank: true, grabTimeoutMs: 3000, screenCopyMethods: ['screen-copy', 'bitblt-screen'],
  });

  /**
   * CaptureSession turns a source into validated, sequenced frames. A frame is {valid, code, reason, seq, tMs, wallMs, image?, width, height, hash,...}.
   * Invalid frames never carry an image: consumers cannot accidentally observe stale or partial pixels.
   */
  class CaptureSession {
    constructor(source, options = {}) {
      ok(source && typeof source.grab === 'function', 'A capture source is required');
      this.src = source; this.o = { ...DEFAULTS, ...options }; this.clock = this.o.clock || mono; this.wall = this.o.wall || (() => Date.now());
      this.listeners = []; this.seq = 0; this.state = 'idle'; this.timer = null; this.running = false; this.busy = false;
      this.expected = null; this.settle = 0; this.fails = 0; this.goods = 0; this.lastT = -Infinity; this.lastSourceT = -Infinity; this.lastHash = null; this.lastFrameId = undefined; this.lastTarget = null;
      this.latestFrame = null; this.recorder = this.o.recorder || null; this.events = [];
      this.m = { requested: 0, valid: 0, invalid: 0, byCode: {}, resolutionChanges: 0, interruptions: 0, recoveries: 0, duplicates: 0, grabMs: [], intervalMs: [] };
    }
    on(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((f) => f !== fn); }; }
    _event(kind, detail) { const e = { kind, detail, at: this.clock() }; this.events.push(e); if (this.events.length > 200) this.events.shift(); }
    async start() {
      ok(this.state === 'idle' || this.state === 'stopped', 'Capture already started');
      const r = await this.src.open();
      if (!r.ok) { this.state = 'stopped'; this._event('open-failed', r.reason); return { ok: false, code: r.code || CODES.FAILED, reason: r.reason }; }
      this.state = 'live'; this.running = true; this._event('started', this.src.target); if (!this.o.manual) this._schedule(0); return { ok: true };
    }
    async stop() { this.running = false; if (this.timer) { clearTimeout(this.timer); this.timer = null; } while (this.busy) await sleep(1); if (this.state !== 'stopped') { await this.src.close(); this.state = 'stopped'; this._event('stopped'); } this.latestFrame = null; }
    _schedule(ms) { if (!this.running) return; this.timer = setTimeout(async () => { this.timer = null; if (!this.running) return; await this.tick(); this._schedule(this._nextDelay()); }, ms); if (this.timer.unref) this.timer.unref(); }
    _nextDelay() { if (this.state === 'interrupted') return Math.min(this.o.retryBackoffMaxMs, this.o.retryBackoffMs * 2 ** Math.min(this.fails, 8)); return this.o.intervalMs; }
    /** The most recent frame IF it is valid and fresh; otherwise null. A caller can never act on an old frame. */
    latest() { const f = this.latestFrame; if (!f || !f.valid) return null; if (this.clock() - f.tMs > this.o.maxFrameAgeMs) return null; return f; }
    /** One capture attempt. Resolves with the frame record whether valid or not. */
    async tick() {
      if (this.busy) return null; this.busy = true;
      const t0 = this.clock(); this.m.requested++;
      let g;
      let tid;
      try { g = await Promise.race([this.src.grab(), new Promise((r) => { tid = setTimeout(() => r({ ok: false, code: CODES.FAILED, reason: 'Capture call exceeded ' + this.o.grabTimeoutMs + ' ms' }), this.o.grabTimeoutMs); })]); }
      catch (e) { g = { ok: false, code: CODES.FAILED, reason: 'Capture threw: ' + e.message }; }
      finally { clearTimeout(tid); }
      const t1 = this.clock(); this.m.grabMs.push(t1 - t0); if (this.m.grabMs.length > 500) this.m.grabMs.shift();
      let frame;
      try { frame = this._judge(g, t1); } finally { this.busy = false; }
      this._finish(frame, t1);
      return frame;
    }
    _judge(g, t) {
      const base = { seq: ++this.seq, tMs: t, wallMs: this.wall(), valid: false, code: CODES.FAILED, reason: null, image: null, width: 0, height: 0, hash: null, duplicate: false, resolutionChanged: false, method: g.meta && g.meta.method || null };
      const bad = (code, reason) => ({ ...base, code, reason });
      if (!g.ok) return bad(g.code || CODES.FAILED, g.reason || 'Capture failed');
      const img = g.image, m = g.meta || {};
      if (!img || !Number.isInteger(img.width) || !Number.isInteger(img.height) || !img.data || img.data.length !== img.width * img.height * 4) return bad(CODES.INVALID, 'Frame buffer is malformed');
      if (img.width < this.o.minWidth || img.height < this.o.minHeight) return bad(CODES.INVALID, 'Frame ' + img.width + 'x' + img.height + ' is below the minimum ' + this.o.minWidth + 'x' + this.o.minHeight);
      if (m.minimized) return bad(CODES.MINIMIZED, 'Target window is minimised');
      if (m.cloaked) return bad(CODES.OCCLUDED, 'Target window is cloaked (on another virtual desktop or hidden)');
      if (this.lastTarget && m.target && (m.target.hwnd !== this.lastTarget.hwnd || (m.target.pid !== undefined && m.target.pid !== this.lastTarget.pid))) return bad(CODES.IDENTITY, 'Capture target identity changed (window handle or process differs)');
      if (m.target && !this.lastTarget) this.lastTarget = { hwnd: m.target.hwnd, pid: m.target.pid };
      const screenCopy = this.o.screenCopyMethods.includes(m.method);
      if ((m.occludedFraction || 0) > this.o.maxOccludedFraction && screenCopy) return bad(CODES.OCCLUDED, Math.round(100 * m.occludedFraction) + '% of the target is covered and this capture method copies what is on screen');
      if ((m.occludedFraction || 0) > 0.5) return bad(CODES.OCCLUDED, Math.round(100 * m.occludedFraction) + '% of the target is covered');
      if (m.sourceTimeMs !== undefined) {
        if (m.sourceTimeMs + 1e-6 < this.lastSourceT) return bad(CODES.CLOCK, 'Source timestamp moved backwards');
      }
      const age = Number.isFinite(m.ageMs) ? m.ageMs : (this.o.sourceClockComparable !== false && Number.isFinite(m.sourceTimeMs) ? t - m.sourceTimeMs : null);
      if (age !== null && age > this.o.maxFrameAgeMs) return bad(CODES.STALE, 'Frame is ' + Math.round(age) + ' ms old (limit ' + this.o.maxFrameAgeMs + ')');
      if (t < this.lastT) return bad(CODES.CLOCK, 'Capture clock moved backwards');
      if (this.o.rejectBlank) {
        const d = img.data; let lo = 255, hi = 0; for (let i = 0; i < d.length; i += 4 * 97) { const v = d[i] + d[i + 1] + d[i + 2]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
        if (hi - lo < 6) return bad(CODES.INVALID, 'Frame is a single flat colour (black or blank capture)');
      }
      // Resolution tracking: a change restarts a settling period; content is released only once the size holds.
      const sz = img.width + 'x' + img.height;
      if (this.expected !== sz) { if (this.expected !== null) { this.m.resolutionChanges++; this._event('resolution-changed', this.expected + ' -> ' + sz); this._pendingChange = true; } this.expected = sz; this.settle = 0; }
      this.settle++;
      if (this.settle < this.o.settleFrames) return { ...bad(CODES.RESIZING, 'Window size changed to ' + sz + '; waiting for it to hold for ' + this.o.settleFrames + ' frames'), width: img.width, height: img.height, resolutionChanged: true };
      const rc = !!this._pendingChange; this._pendingChange = false;
      const hash = IC.fingerprint(img), dup = hash === this.lastHash && (m.sourceFrameId === undefined || m.sourceFrameId === this.lastFrameId);
      if (this.o.requireSourceTimeAdvance && dup && m.sourceTimeMs !== undefined && m.sourceTimeMs <= this.lastSourceT) return bad(CODES.STALE, 'Source reported no new frame');
      return { ...base, valid: true, code: CODES.OK, image: img, width: img.width, height: img.height, hash, duplicate: dup, resolutionChanged: rc, dpiScale: m.dpiScale || 1, bounds: m.bounds || null, viewSeat: m.viewSeat, clientRevision: m.clientRevision, target: m.target || null, sourceFrameId: m.sourceFrameId, sourceTimeMs: m.sourceTimeMs };
    }
    _finish(frame, t) {
      this.m.byCode[frame.code] = (this.m.byCode[frame.code] || 0) + 1;
      if (frame.valid) {
        this.m.valid++; if (frame.duplicate) this.m.duplicates++;
        if (Number.isFinite(this.lastT) && this.lastT > -Infinity) { this.m.intervalMs.push(t - this.lastT); if (this.m.intervalMs.length > 500) this.m.intervalMs.shift(); }
        this.lastT = t; this.lastHash = frame.hash; this.lastFrameId = frame.sourceFrameId; if (frame.sourceTimeMs !== undefined) this.lastSourceT = frame.sourceTimeMs;
        this.fails = 0; this.goods++;
        if (this.state === 'interrupted') { this.state = 'recovering'; this.goods = 1; this._event('recovering'); }
        if (this.state === 'recovering' && this.goods >= this.o.recoveryGoodFrames) { this.state = 'live'; this.m.recoveries++; this._event('recovered'); }
        this.latestFrame = frame;
      } else {
        this.m.invalid++; this.fails++; this.goods = 0; this.latestFrame = frame; // frame has no image
        if (frame.code === CODES.RESIZING) { /* expected transient; not an interruption */ }
        else if (this.fails >= this.o.failuresBeforeInterrupted && this.state !== 'interrupted' && this.state !== 'stopped') { this.state = 'interrupted'; this.m.interruptions++; this._event('interrupted', frame.code + ': ' + frame.reason); }
        if (frame.code === CODES.LOST || frame.code === CODES.IDENTITY) { this.lastTarget = frame.code === CODES.IDENTITY ? this.lastTarget : null; }
        if (frame.code !== CODES.OK && this.state === 'recovering') this.state = 'interrupted';
      }
      if (this.recorder && (frame.valid || this.o.recordInvalid)) { try { this.recorder.record(frame.valid ? frame : { ...frame, image: this.o.recordInvalid && this._blank() }); } catch (e) { this._event('recorder-error', e.message); } }
      for (const fn of this.listeners) { try { fn(frame); } catch (e) { this._event('listener-error', e.message); } }
      // The image of a frame stays only on the valid record handed to listeners; the session keeps one valid latest.
    }
    _blank() { return null; }
    status() {
      const a = this.m.grabMs, avg = a.length ? a.reduce((x, y) => x + y, 0) / a.length : null, iv = this.m.intervalMs, ivAvg = iv.length ? iv.reduce((x, y) => x + y, 0) / iv.length : null;
      return { state: this.state, seq: this.seq, expectedSize: this.expected, requested: this.m.requested, valid: this.m.valid, invalid: this.m.invalid, byCode: { ...this.m.byCode }, resolutionChanges: this.m.resolutionChanges, interruptions: this.m.interruptions, recoveries: this.m.recoveries, duplicates: this.m.duplicates, grabMsMean: avg, effectiveIntervalMs: ivAvg, effectiveFps: ivAvg ? 1000 / ivAvg : null, lastCode: this.latestFrame && this.latestFrame.code, lastReason: this.latestFrame && this.latestFrame.reason };
    }
  }

  return { CODES, DEFAULTS, validateMonitors, resolveRegion, logicalToPhysical, ImageSequenceSource, SimulatedWindowSource, HostCaptureSource, FrameRecorder, CaptureSession };
});
