/* EightMax Test Workbench 0.25: capture manager — backend registry, selection, switching, bounded queue, health, observation gate.
 *
 * Sits on top of the 0.24 CaptureSession (which validates every frame). It adds what a platform-independent test rig needs:
 *   * an honest catalogue of capture backends and their VERIFIED status (Windows Graphics Capture is listed as NOT implemented);
 *   * profile-driven backend selection with fallback, and run-time switching;
 *   * a bounded frame queue (oldest dropped, counted) so a slow reader can never receive an old frame as if it were new;
 *   * capture-health roll-up (stale / blank / resolution / interruption / latency);
 *   * ObservationGate: the last check before an observation may reach decision-making or execution.
 * Only documented capture mechanisms are used. Nothing here reads another process's memory, hides itself or defeats a client's protections.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./screen-capture.js'));
  else root.WorkbenchCaptureManager = factory(root.WorkbenchCapture);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CAP) {
  'use strict';

  const mono = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const ok = (x, m) => { if (!x) throw new Error(m); };
  const { CODES } = CAP;

  /**
   * What each backend IS, as of this build. `verification` is the strongest thing actually done:
   *   'tested-linux'     exercised by automated tests in this repository (no real window involved)
   *   'windows-unrun'    code exists and compiles but has never been executed on Windows
   *   'not-implemented'  no code
   */
  const CATALOG = Object.freeze({
    'structured-feed': { label: 'Structured test-state feed', platform: 'any', implemented: true, verification: 'tested-linux', opticalRecognition: false, note: 'Observations arrive as data; never counts as image recognition.' },
    'screenshot-file': { label: 'Offline screenshot files', platform: 'any', implemented: true, verification: 'tested-linux', opticalRecognition: true },
    'video-replay': { label: 'Recorded frame replay (PNG/BMP sequence)', platform: 'any', implemented: true, verification: 'tested-linux', opticalRecognition: true, note: 'Video files must first be converted to a frame sequence; no video decoder is bundled.' },
    'window': { label: 'Selected window (host chooses the method below)', platform: 'windows', implemented: true, verification: 'windows-unrun', opticalRecognition: true },
    'desktop-region': { label: 'Selected desktop region', platform: 'windows', implemented: true, verification: 'windows-unrun', opticalRecognition: true },
    'printwindow': { label: 'PrintWindow (Win32)', platform: 'windows', implemented: true, verification: 'windows-unrun', opticalRecognition: true, note: 'May return blank for GPU-composited windows; blank frames are rejected.' },
    'bitblt': { label: 'BitBlt screen copy (Win32)', platform: 'windows', implemented: true, verification: 'windows-unrun', opticalRecognition: true, note: 'Copies what is on screen: occluded windows are rejected.' },
    'windows-graphics-capture': { label: 'Windows Graphics Capture', platform: 'windows', implemented: false, verification: 'not-implemented', opticalRecognition: true, note: 'Not implemented in 0.25 (needs WinRT/Direct3D interop that could not be compiled or run here). Planned for 0.26.' },
    'simulated-window': { label: 'Simulated window (controlled client renderer)', platform: 'any', implemented: true, verification: 'tested-linux', opticalRecognition: true, note: 'Reproduces capture failure modes for tests; it is not an OS capture API.' },
  });

  /** Window identity: the operator selected THIS window; later frames must come from the same one. Titles may change (hands, clocks), so they are matched by pattern only if the profile gives one. */
  function checkWindowIdentity(selected, current, opt = {}) {
    const problems = [];
    if (!selected || !current) return { ok: false, problems: ['window missing'] };
    if (selected.hwnd !== current.hwnd) problems.push('window handle changed (' + selected.hwnd + ' -> ' + current.hwnd + ')');
    if (selected.pid !== undefined && current.pid !== undefined && selected.pid !== current.pid) problems.push('process id changed (' + selected.pid + ' -> ' + current.pid + ')');
    if (selected.className && current.className && selected.className !== current.className) problems.push('window class changed');
    if (opt.titleContains && !(String(current.title || '').toLowerCase().includes(String(opt.titleContains).toLowerCase()))) problems.push('title no longer contains "' + opt.titleContains + '"');
    return { ok: problems.length === 0, problems };
  }

  /** Pick the first backend from `preferred` that is implemented, allowed by the profile and available on this host. Returns the decision with the reasons each earlier one was skipped. */
  function selectBackend(profileMethods, preferred, availability) {
    const skipped = [], order = (preferred && preferred.length ? preferred : profileMethods).filter((m, i, a) => a.indexOf(m) === i);
    for (const m of order) {
      const c = CATALOG[m];
      if (!c) { skipped.push({ id: m, reason: 'unknown backend' }); continue; }
      if (!profileMethods.includes(m)) { skipped.push({ id: m, reason: 'not allowed by the platform profile' }); continue; }
      if (!c.implemented) { skipped.push({ id: m, reason: 'not implemented in this build' }); continue; }
      if (availability && availability[m] === false) { skipped.push({ id: m, reason: 'not available on this host' }); continue; }
      return { ok: true, id: m, skipped };
    }
    return { ok: false, id: null, skipped, reason: 'No usable capture backend' };
  }

  /** Bounded queue of VALID frames. When full the oldest is dropped (counted); a consumer can ask for the newest and discard the backlog. */
  class FrameQueue {
    constructor(max = 4) { ok(Number.isInteger(max) && max >= 1 && max <= 64, 'Queue size 1..64'); this.max = max; this.items = []; this.dropped = 0; this.enqueued = 0; }
    push(frame) { ok(frame && frame.valid && frame.image, 'Only valid frames with pixels may be queued'); this.enqueued++; if (this.items.length >= this.max) { this.items.shift(); this.dropped++; } this.items.push(frame); }
    shift() { return this.items.shift() || null; }
    newest(discardOlder = true) { const f = this.items[this.items.length - 1] || null; if (discardOlder && f) { this.dropped += this.items.length - 1; this.items = []; } return f; }
    get length() { return this.items.length; }
  }

  /**
   * CaptureManager: owns one CaptureSession at a time. `factory(backendId, profile)` builds a source (host-backed, file-backed, simulated...).
   * Options: profile, factory, availability, queueSize, sessionOptions, healthWindow
   */
  class CaptureManager {
    constructor(o = {}) {
      ok(o.profile && o.profile.capture && Array.isArray(o.profile.capture.methods), 'A platform profile is required'); ok(typeof o.factory === 'function', 'A source factory is required');
      this.profile = o.profile; this.factory = o.factory; this.availability = o.availability || {}; this.queue = new FrameQueue(o.queueSize || 4); this.sessionOptions = o.sessionOptions || {};
      this.clock = o.clock || mono; this.manual = !!o.manual; this.session = null; this.backend = null; this.switches = []; this.listeners = []; this.healthWindow = o.healthWindow || 40; this.recent = [];
    }
    on(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((f) => f !== fn); }; }
    /** Try the profile's preferred backends in order; a backend that cannot be built or opened is skipped (with the reason) and the next is tried. */
    async start(preferredId) {
      const order = (preferredId ? [preferredId] : (this.profile.capture.preferred && this.profile.capture.preferred.length ? this.profile.capture.preferred : this.profile.capture.methods)), skipped = [];
      for (const id of order) {
        const sel = selectBackend(this.profile.capture.methods, [id], this.availability); if (!sel.ok) { skipped.push(...sel.skipped); continue; }
        const r = await this._open(id, skipped.slice()); if (r.ok) return r; skipped.push({ id, reason: r.reason });
      }
      return { ok: false, code: CODES.FAILED, reason: 'No usable capture backend', skipped };
    }
    async _open(id, skipped = []) {
      let source; try { source = await this.factory(id, this.profile); } catch (e) { return { ok: false, code: CODES.FAILED, reason: 'Could not build ' + id + ': ' + e.message, skipped }; }
      const s = new CAP.CaptureSession(source, { clock: this.clock, minWidth: this.profile.capture.scaling.minWidth || 320, manual: this.manual, ...this.sessionOptions });
      s.on((f) => this._onFrame(f));
      const r = await s.start(); if (!r.ok) return { ok: false, code: r.code, reason: r.reason, skipped };
      this.session = s; this.backend = id; return { ok: true, backend: id, skipped };
    }
    _onFrame(f) {
      this.recent.push({ valid: f.valid, code: f.code, dup: !!f.duplicate, t: f.tMs }); if (this.recent.length > this.healthWindow) this.recent.shift();
      if (f.valid && !f.duplicate) this.queue.push(f);
      else if (!f.valid && this.queue.length) { this.queue.dropped += this.queue.length; this.queue.items = []; } // a failure breaks continuity: frames from before it are not offered afterwards
      for (const fn of this.listeners) { try { fn(f); } catch (e) { /* listener faults never stop capture */ } }
    }
    /** Switch backend at run time. The queue is flushed: frames from the old source are never mixed with the new one. */
    async switchTo(id) {
      const sel = selectBackend(this.profile.capture.methods, [id], this.availability); if (!sel.ok) return { ok: false, reason: sel.skipped[0] ? sel.skipped[0].reason : sel.reason };
      const old = this.backend; if (this.session) await this.session.stop(); this.queue = new FrameQueue(this.queue.max); this.recent = [];
      const r = await this._open(id); this.switches.push({ from: old, to: id, ok: r.ok, reason: r.reason || null, at: this.clock() }); return r;
    }
    async stop() { if (this.session) await this.session.stop(); this.session = null; }
    /** Newest valid, fresh frame (or null) and everything older is discarded. */
    nextFrame() { const s = this.session; if (!s) return null; const f = this.queue.newest(true); if (!f) return null; return s.clock() - f.tMs > s.o.maxFrameAgeMs ? null : f; }
    health() {
      const r = this.recent.filter((x) => x.code !== CODES.RESIZING), n = r.length, bad = r.filter((x) => !x.valid), byCode = {}; // frames that merely wait for a resized window to settle are expected, not failures for (const b of bad) byCode[b.code] = (byCode[b.code] || 0) + 1;
      const st = this.session ? this.session.status() : null, invalidRatio = n ? bad.length / n : null;
      let lastValidAgeMs = null; const lv = [...r].reverse().find((x) => x.valid); if (lv) lastValidAgeMs = this.clock() - lv.t;
      const tailBad = (() => { let c = 0; for (let i = r.length - 1; i >= 0 && !r[i].valid; i--) c++; return c; })();
      const reasons = []; if (!this.session) reasons.push('capture not running'); if (st && st.state !== 'live') reasons.push('state ' + st.state); if (invalidRatio !== null && invalidRatio > 0.2) reasons.push('invalid ratio ' + invalidRatio.toFixed(2)); if (tailBad >= 2) reasons.push(tailBad + ' consecutive invalid frames'); if (lastValidAgeMs !== null && this.session && lastValidAgeMs > this.session.o.maxFrameAgeMs) reasons.push('newest valid frame is ' + Math.round(lastValidAgeMs) + ' ms old'); if (n === 0 && this.session) reasons.push(this.recent.length ? 'waiting for the window size to settle' : 'no frames yet');
      return { healthy: reasons.length === 0, reasons, backend: this.backend, state: st && st.state, window: n, invalidRatio, invalidByCode: byCode, consecutiveInvalid: tailBad, lastValidAgeMs, queue: { length: this.queue.length, dropped: this.queue.dropped, enqueued: this.queue.enqueued }, grabMsMean: st && st.grabMsMean, effectiveFps: st && st.effectiveFps, resolutionChanges: st && st.resolutionChanges, interruptions: st && st.interruptions, recoveries: st && st.recoveries, switches: this.switches.slice() };
    }
  }

  /**
   * The last gate before an observation may be used to decide or act. It never repairs: a failed gate returns reasons and the caller must wait for a better frame.
   * Checks: frame validity and freshness, recognition ok, confidence floor, sequence monotonic, client revision monotonic, capture healthy, table identity.
   */
  class ObservationGate {
    constructor(o = {}) { this.minConfidence = o.minConfidence === undefined ? 0.8 : o.minConfidence; this.maxAgeMs = o.maxAgeMs || 1000; this.clock = o.clock || mono; this.lastSeq = -1; this.lastRevision = -Infinity; this.table = o.table; this.health = o.health || null; this.counts = { admitted: 0, rejected: 0, byReason: {} }; }
    admit(frame, recognition) {
      const why = [];
      if (!frame || !frame.valid) why.push('frame-invalid:' + (frame && frame.code));
      else if (this.clock() - frame.tMs > this.maxAgeMs) why.push('frame-stale');
      if (frame && frame.valid && frame.seq <= this.lastSeq) why.push('frame-out-of-order');
      if (!recognition || recognition.ok !== true || !recognition.observation) why.push('recognition-failed');
      else {
        const ob = recognition.observation;
        if (ob.confidence && ob.confidence.overall < this.minConfidence) why.push('low-confidence:' + ob.confidence.overall.toFixed(2));
        if (this.table !== undefined && ob.table !== undefined && ob.table !== this.table) why.push('wrong-table');
        if (frame && frame.clientRevision !== undefined && frame.clientRevision < this.lastRevision) why.push('revision-regressed');
        if (ob.source !== 'image' && ob.source !== undefined && ob.source !== 'structured-feed') why.push('unknown-observation-source');
      }
      if (this.health) { const h = typeof this.health === 'function' ? this.health() : this.health; if (h && h.healthy === false) why.push('capture-unhealthy'); }
      if (why.length) { this.counts.rejected++; for (const w of why) { const k = w.split(':')[0]; this.counts.byReason[k] = (this.counts.byReason[k] || 0) + 1; } return { admit: false, reasons: why }; }
      this.lastSeq = frame.seq; if (frame.clientRevision !== undefined) this.lastRevision = frame.clientRevision; this.counts.admitted++;
      return { admit: true, observation: recognition.observation, frameSeq: frame.seq, imageBased: recognition.observation.source === 'image' };
    }
  }

  /** Structured test-state feed: observations arrive as data from an approved test source. Validated, and always labelled non-optical. */
  class StructuredFeed {
    constructor(o = {}) { this.maxAgeMs = o.maxAgeMs || 2000; this.clock = o.clock || mono; this.lastSeq = -1; this.rejected = 0; this.accepted = 0; }
    ingest(obs, sentAtMs) {
      const why = [];
      if (!obs || obs.format !== 'eightmax-observation') why.push('not-an-observation');
      else { if (!Number.isInteger(obs.seq) || obs.seq <= this.lastSeq) why.push('sequence-not-increasing'); if (!Array.isArray(obs.seats) || obs.seats.length !== 8) why.push('seats-malformed'); }
      if (Number.isFinite(sentAtMs) && this.clock() - sentAtMs > this.maxAgeMs) why.push('stale');
      if (why.length) { this.rejected++; return { ok: false, reasons: why }; }
      this.lastSeq = obs.seq; this.accepted++; return { ok: true, observation: { ...obs, source: 'structured-feed', opticalRecognition: false } };
    }
  }

  return { CATALOG, checkWindowIdentity, selectBackend, FrameQueue, CaptureManager, ObservationGate, StructuredFeed };
});
