/* EightMax Test Workbench 0.35.0: SIMULATOR CONTROLS - screen capture -> recognition -> state -> decision -> validation ->
 * visible input -> capture again -> confirmation, for windows of the operator's OWN simulator (or the bundled test table).
 *
 *   Capture       desktop host /api/capture/frame (PrintWindow or Windows Graphics Capture; the operator consented per window)
 *   Recognise     the calibrated table reader (vision-ocr ImageObserver) + the status strip when the profile has one
 *   Reconstruct   HandStateEngine (refuses inconsistent readings; pauses the table)
 *   Decide        SolverService (EightMax decisions) or, only where allowed, a labelled SCRIPTED policy
 *   Validate      TestExecutor (study/simulation/qa modes, freshness, legality, duplicates, authorisation)
 *   Input         UiAutomationAdapter -> WindowsUiDriver -> desktop host -> EightMaxInput.exe, inside ONE scheduler lease
 *   Confirm       new captures until the frame changes, then confirmAction(before, after): confirmed / rejected / ambiguous /
 *                 timed-out / cancelled. Anything but confirmed pauses the table; nothing is ever re-sent blindly.
 * No input is sent unless the reading is complete and fresh; uncertain recognition is a reason to wait, never to guess.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./hand-state.js'), require('./solver-service.js'), require('./test-executor.js'), require('./execution-adapters.js'), require('./vision-ocr.js'), require('./sim-display.js'), require('./image-codec.js'), require('./status-strip.js'), require('./windows-input-driver.js'), require('./input-scheduler.js'), require('./input-geometry.js'), require('./input-motion.js'), require('./full-hand.js'));
  else root.WorkbenchSimulatorControls = factory(root.EightMax, root.WorkbenchHandState, root.WorkbenchSolverService, root.WorkbenchExecutor, root.WorkbenchExecutionAdapters, root.WorkbenchVisionOcr, root.WorkbenchSimDisplay, root.WorkbenchImageCodec, root.WorkbenchStatusStrip, root.WorkbenchInputDriver, root.WorkbenchInputScheduler, root.WorkbenchInputGeometry, root.WorkbenchInputMotion, root.WorkbenchFullHand);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (EM, HS, SS, EX, XA, OCR, SIM, IC, STRIP, DRV, SCH, G, M, FH) {
  'use strict';
  const mono = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ok = (v, m) => { if (!v) throw new Error(m); };
  const b64 = (s) => (typeof Buffer !== 'undefined' ? Buffer.from(s, 'base64') : Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

  /** Authenticated client of the local desktop host (same session token as the dashboard). Bounded concurrency. */
  class HostApi {
    constructor({ origin = 'http://127.0.0.1:48713', token, fetch: f, maxConcurrent = 6, timeoutMs = 30000 }) { ok(typeof token === 'string' && /^[a-f0-9]{64}$/.test(token), 'Desktop session token required'); this.origin = origin; this.token = token; this.f = f || fetch; this.slots = maxConcurrent; this.waiters = []; this.timeoutMs = timeoutMs; }
    async _slot() { if (this.slots > 0) { this.slots--; return; } await new Promise((r) => this.waiters.push(r)); }
    _free() { const w = this.waiters.shift(); if (w) w(); else this.slots++; }
    async request(path, body, timeoutMs) {
      ok(/^\/api\/(input\/(command|status|estop|restart|stop|settings)|capture\/(windows|monitors|open|frame|close)|desktop\/health)$/.test(path), 'Route not used by Simulator Controls: ' + path);
      await this._slot();
      try {
        const ctl = typeof AbortController === 'function' ? new AbortController() : null, timer = ctl ? setTimeout(() => ctl.abort(), (timeoutMs || this.timeoutMs) + 5000) : null;
        try {
          const r = await this.f(this.origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-EightMax-Session': this.token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl ? ctl.signal : undefined, cache: 'no-store' });
          const text = await r.text(); let v; try { v = JSON.parse(text); } catch (e) { throw new Error('Host returned invalid JSON for ' + path); }
          if (!r.ok) { const e = new Error(v && v.error || 'Host refused ' + path); e.code = v && v.code; e.status = r.status; throw e; }
          return v;
        } finally { if (timer) clearTimeout(timer); }
      } finally { this._free(); }
    }
  }
  /** A DriverSession whose commands travel through the host broker. */
  function hostSession(api) {
    const t = DRV.hostTransport((path, msg) => api.request(path, msg, msg.timeoutMs).catch((e) => ({ ok: false, code: e.code || 'host-error', error: e.message })));
    const s = new DRV.DriverSession(t); s.helloed = true; return s;
  }

  /** Window capture through the host: returns {ok, image, bounds, title, frameId, at} after decoding and size checks. */
  class HostWindowCapture {
    constructor(api, target, o = {}) { this.api = api; this.target = { kind: 'window', hwnd: target.hwnd, pid: target.pid, title: target.title, method: o.method || 'print-window' }; this.opened = false; this.frames = 0; this.failures = 0; }
    async open() { const r = await this.api.request('/api/capture/open', { target: this.target, consent: true }); this.opened = !!(r && r.ok); return r; }
    async grab() {
      const t0 = mono(); let r; try { r = await this.api.request('/api/capture/frame', { target: this.target }); } catch (e) { this.failures++; return { ok: false, code: e.code || 'capture-failed', reason: e.message }; }
      if (!r || r.ok !== true) { this.failures++; return { ok: false, code: r && r.code || 'capture-failed', reason: r && r.reason || 'no frame', minimized: r && r.minimized }; }
      let image; try { image = IC.decodePng(b64(r.png)); } catch (e) { this.failures++; return { ok: false, code: 'decode-failed', reason: e.message }; }
      if (image.width !== r.width || image.height !== r.height) return { ok: false, code: 'size-mismatch', reason: 'decoded size differs' };
      this.frames++; return { ok: true, image, bounds: r.bounds, title: r.title || (r.target && r.target.title), frameId: r.frameId, method: r.method, dpiScale: r.dpiScale, at: mono(), captureMs: mono() - t0 };
    }
    async close() { try { await this.api.request('/api/capture/close', { target: this.target }); } catch (e) { /* host gone */ } }
  }

  /** The calibrated reader for one table (templates come from the controlled renderer; never from the oracle). */
  const readerCache = new Map();
  function tableReader(tableId, seats = 8) { const key = seats; let cal = readerCache.get(key); if (!cal) { cal = SIM.calibrate([800, 960, 1280, 1440, 1920], SIM.layoutFor(seats, true)); readerCache.set(key, cal); } return new OCR.ImageObserver({ table: tableId, profiles: cal.profiles, cards: cal.cards, glyphs: cal.glyphs, seats }); }

  const DEFAULTS = Object.freeze({ maxRefusalsInRow: 4, maxObservationAgeMs: 2500, postActionTimeoutMs: 4000, pollMs: 60, decisionWindowMs: 12000, idlePollMs: 120, maxConsecutiveRejects: 40, revalidate: 'capture' });

  /**
   * One registered simulator window under automation.
   * o: id, window {hwnd,pid,title,client}, profile (platform profile), api, session, scheduler, authorization, recorder,
   *    decide(state) -> decision | null (EightMax), allowScripted, motion, timing, options
   */
  class SimulatorTable {
    constructor(o) {
      this.id = o.id; this.win = o.window; this.profile = o.profile; this.api = o.api; this.s = o.session; this.sched = o.scheduler; this.rec = o.recorder || null; this.opt = { ...DEFAULTS, ...(o.options || {}) };
      this.capture = new HostWindowCapture(o.api, o.window, { method: o.captureMethod });
      this.reader = tableReader(o.id, 8); this.engine = new HS.HandStateEngine(o.id, { track: true, seats: 8, expectedLayout: 'eightmax-8max-v2' });
      this.strip = !!(o.profile.layout && o.profile.layout.statusStrip);
      this.lastFrame = null; this.state = null; this.paused = null; this.stopped = false; this.rng = new EM.RNG((o.seed || 1) * 7 + o.id);
      this.decide = o.decide || null; this.allowScripted = !!o.allowScripted;
      const e = o.profile.execution || {}, controls = { ...(o.profile.layout.controls || {}), ...(e.controls || {}) };
      this.driver = new DRV.WindowsUiDriver({ session: o.session, hwnd: o.window.hwnd, motion: o.motion, timing: o.timing, focusPolicy: o.focusPolicy, expectClient: () => this.lastFrame && this.lastFrame.client, onTrace: (ev) => this._diag('execution', ev) });
      this.driver.estimateFor = (region, box, wager) => { const c = this.lastFrame && this.lastFrame.client; if (!c) return 0; let ms = this.driver.estimateMs(box, c); if (wager) ms += this.driver.estimateMs(e.amountField, c) + this.driver.estimateTypingMs(wager.text); return ms; };
      this.adapter = new XA.UiAutomationAdapter({ authorization: o.qaAuthorization, now: () => Date.now(), driver: this.driver, controls, amountField: e.amountField, amountConvention: e.amountConvention, chipUnit: e.chipUnit, scheduler: o.scheduler, deadlineMs: this.opt.decisionWindowMs, controlledFixture: o.profile.verification && o.profile.verification.status === 'controlled-renderer' && e.controlledFixture === true, table: o.id });
      this.executor = new EX.TestExecutor({ stateOf: () => ({ state: this.engine.state, paused: this.engine.paused || !!this.paused, pauseReason: this.engine.pauseReason || this.paused, revision: this.engine.revision }), now: () => Date.now(), maxActionAgeMs: this.opt.decisionWindowMs, hrnow: mono });
      this.executor.setMode('qa', { authorization: o.qaAuthorization }); this.executor.attach(o.id, this.adapter);
      this.m = { frames: 0, rejectedFrames: 0, decisions: 0, scripted: 0, solver: 0, unavailable: 0, attempted: 0, confirmed: 0, rejected: 0, ambiguous: 0, timedOut: 0, cancelled: 0, blocked: 0, deadline: 0, errors: 0, e2e: [], cursor: [], input: [], wait: [], confirmMs: [], focusErrors: 0, driverErrors: 0 };
      this.log = [];
    }
    _diag(stage, detail) { if (this.rec) { try { this.rec.record(this.id, stage, { hwnd: this.win.hwnd, hand: this.state && this.state.hand, revision: this.engine.revision, ...detail }); } catch (e) { /* bounded recorder */ } } }
    pause(reason) { this.paused = reason; this.executor.pauseTable(this.id, reason); if (this.sched) this.sched.pauseTable(this.id, reason); this._diag('system', { kind: 'pause', reason }); }
    resume() { this.paused = null; this.executor.resumeTable(this.id); if (this.sched) this.sched.resumeTable(this.id); this.engine.resume(); this._diag('system', { kind: 'resume' }); }
    /** Capture + read + reconstruct. {state, frame} | {reject}. */
    async look() {
      const g = await this.capture.grab(); this.m.frames++;
      if (!g.ok) { this.m.rejectedFrames++; this._diag('capture', { ok: false, code: g.code, reason: g.reason }); return { reject: 'capture ' + g.code + ': ' + g.reason, code: g.code }; }
      const client = { x: g.bounds.x, y: g.bounds.y, w: g.bounds.width, h: g.bounds.height }, frame = { client, at: g.at, frameId: g.frameId, title: g.title };
      if (this.win.title && !(g.title || '').startsWith(this.win.title)) return { reject: 'wrong window: the title no longer starts with ' + JSON.stringify(this.win.title) };
      let view = this.profile.layout.heroSeat || 0, rev;
      if (this.strip) { const st = STRIP.read(g.image); if (!st.ok) { this.m.rejectedFrames++; return { reject: 'status strip: ' + st.reason }; } if (st.table !== this.id) return { reject: 'wrong table: the window shows table ' + st.table }; view = st.viewSeat; rev = st.revision; frame.strip = st; }
      const r = this.reader.observe(g.image, { heroSeat: view, capturedAt: Date.now() });
      if (!r.ok) { this.m.rejectedFrames++; this._diag('recognition', { ok: false, reasons: r.reasons.slice(0, 3) }); return { reject: 'recognition: ' + r.reasons.slice(0, 2).join('; ') }; }
      if (rev !== undefined) r.observation.simRevision = rev;
      const x = this.engine.ingest(r.observation);
      if (!x.accepted) { this.m.rejectedFrames++; this._diag('state', { ok: false, issues: x.issues.slice(0, 3) }); return { reject: 'state: ' + x.issues.map((i) => i.code).join(', '), issues: x.issues }; }
      this.lastFrame = frame; this.state = x.state; this._diag('state', { ok: true, frameId: g.frameId, actor: x.state.actor, status: x.state.status, captureMs: g.captureMs });
      return { state: x.state, frame };
    }
    /** Re-capture inside the lease: the screen must still show the observed frame (same revision, same hand, same actor, same layout). */
    async _revalidate(st, frame) {
      if (this.paused) return { ok: false, reason: 'table paused' };
      if (mono() - frame.at > this.opt.maxObservationAgeMs) { if (this.opt.revalidate !== 'capture') return { ok: false, reason: 'observation older than ' + this.opt.maxObservationAgeMs + ' ms' }; }
      if (this.opt.revalidate !== 'capture') return { ok: true };
      const g = await this.capture.grab(); if (!g.ok) return { ok: false, reason: 'capture ' + g.code };
      const c = { x: g.bounds.x, y: g.bounds.y, w: g.bounds.width, h: g.bounds.height }, f = frame.client;
      if (c.x !== f.x || c.y !== f.y || c.w !== f.w || c.h !== f.h) return { ok: false, reason: 'window moved or resized since the reading' };
      if (this.strip) { const s2 = STRIP.read(g.image); if (!s2.ok || s2.revision !== frame.strip.revision || s2.table !== this.id) return { ok: false, reason: 'the table changed since the reading' }; }
      return { ok: true };
    }
    /** After input: capture until the frame changes, then compare. */
    async _confirm(sent, before, beforeFrame, deadline) {
      const t0 = mono();
      while (mono() - t0 < this.opt.postActionTimeoutMs) {
        if (this.stopped) return { confirmed: false, status: 'cancelled', reason: 'stopped' };
        await sleep(this.opt.pollMs);
        const g = await this.capture.grab(); if (!g.ok) continue;
        if (this.strip) { const st = STRIP.read(g.image); if (!st.ok || st.revision === beforeFrame.strip.revision) continue; }
        // a new frame: read it fully
        const v = await this._readImage(g); if (!v.state) continue;
        const c = XA.confirmAction(sent, before, v.state); this.m.confirmMs.push(mono() - t0);
        if (c.status === 'confirmed') return { confirmed: true, status: 'confirmed', observed: c.observed };
        return { confirmed: false, status: c.status, reason: c.reason, clean: c.status === 'rejected' };
      }
      // the frame never changed: the simulator ignored the input (rejected) - but say so only if a fresh reading shows the same actor
      const v = await this.look(); if (v.state) { const c = XA.confirmAction(sent, before, v.state); if (c.status === 'confirmed') return { confirmed: true, status: 'confirmed', observed: c.observed }; if (c.status === 'rejected') return { confirmed: false, status: 'rejected', clean: true, reason: 'no change within ' + this.opt.postActionTimeoutMs + ' ms; same actor still to act' }; }
      return { confirmed: false, status: 'timed-out', reason: 'no reliable reading within ' + this.opt.postActionTimeoutMs + ' ms' };
    }
    async _readImage(g) {
      const client = { x: g.bounds.x, y: g.bounds.y, w: g.bounds.width, h: g.bounds.height };
      let view = this.profile.layout.heroSeat || 0, rev; if (this.strip) { const st = STRIP.read(g.image); if (!st.ok) return {}; view = st.viewSeat; rev = st.revision; }
      const r = this.reader.observe(g.image, { heroSeat: view, capturedAt: Date.now() }); if (!r.ok) return {};
      if (rev !== undefined) r.observation.simRevision = rev; const x = this.engine.ingest(r.observation); if (!x.accepted) return {};
      this.state = x.state; this.lastFrame = { client, at: g.at, frameId: g.frameId, strip: this.strip ? STRIP.read(g.image) : null }; return { state: x.state };
    }
    _decision(st) {
      let d = null; if (this.decide) { try { d = this.decide(st); } catch (e) { d = null; } }
      if (d && d.status === 'ok' && d.source === 'eightmax-study') { this.m.solver++; return d; }
      this.m.unavailable++; if (!this.allowScripted) return null;
      this.m.scripted++; return FH.scriptedDecision(st, this.rng);
    }
    /** One cycle: read; if this table must act, decide, execute through the scheduler, confirm. */
    async step() {
      if (this.stopped) return { kind: 'stopped' }; if (this.paused) return { kind: 'paused', reason: this.paused };
      const v = await this.look(); if (!v.state) return { kind: 'no-reading', reason: v.reject };
      const st = v.state; if (st.status !== 'playing' || !(st.actor >= 0)) return { kind: 'waiting' };
      const l = st.legal || {}; if (!(l.canFold || l.canCheck || l.canCall || l.canRaise)) return { kind: 'waiting', reason: 'no action controls on screen' };
      const heroOnly = this.profile.layout.heroSeat !== undefined && !this.strip; if (heroOnly && st.actor !== this.profile.layout.heroSeat) return { kind: 'waiting' };
      const decision = this._decision(st); if (!decision) { this.pause('no EightMax decision for this state and no fallback allowed'); return { kind: 'unavailable' }; }
      this.m.decisions++; const deadline = v.frame.at + this.opt.decisionWindowMs, before = st, frame = v.frame;
      this._diag('decision', { source: decision.source, recommended: decision.recommended, label: decision.label, frameId: frame.frameId });
      const sentRef = {}; this.m.attempted++;
      // Extend the adapter submission with the deadline and the in-lease revalidation (the executor passes `act` through).
      const origSubmit = this.adapter.submit.bind(this.adapter);
      this.adapter.submit = (act) => { sentRef.act = act; act.deadline = deadline; act.revalidate = () => this._revalidate(st, frame); return origSubmit(act); };
      const tStart = mono(); let x;
      try {
        x = await this.executor.execute(decision, { allowScripted: decision.source === 'scripted-fallback', verify: async ({ action }) => { const sent = { seat: st.actor, type: action.type === 'raise' ? 'raise' : action.type, amount: action.amount }; const c = await this._confirm(sent, before, frame, deadline); this._diag('ack', { status: c.status, reason: c.reason }); this._lastConfirm = c; return c; } });
      } finally { this.adapter.submit = origSubmit; }
      const ms = mono() - tStart; const entry = { t: Date.now(), hand: st.hand, seat: st.actor, status: x.status, action: x.action || null, intended: decision.executable && decision.executable[decision.recommendedSlot], reason: x.reason || null, source: decision.source, input: x.input || null, ms };
      if (x.status === 'confirmed') { this.m.confirmed++; this.m.e2e.push(mono() - frame.at); if (x.input) { if (x.input.actualMs) this.m.cursor.push(x.input.actualMs); } this.m.input.push(ms); }
      else if (x.status === 'rejected') { if (/scheduler: Cannot finish by the deadline/.test(x.reason || '')) this.m.deadline++; if (/focus/.test(x.reason || '')) this.m.focusErrors++; if (/driver-exited|internal-error|timeout/.test(x.reason || '')) this.m.driverErrors++; this.m.rejected++; }
      else if (x.status === 'unconfirmed') { const c = this._lastConfirm || {}; if (c.status === 'timed-out') this.m.timedOut++; else if (c.status === 'cancelled') this.m.cancelled++; else this.m.ambiguous++; }
      else if (x.status === 'aborted') this.m.cancelled++; else this.m.blocked++;
      this.log.push(entry); if (this.log.length > 3000) this.log.shift();
      if (x.status !== 'confirmed' && this.executor.pausedTables.has(this.id) && !this.paused) this.paused = this.executor.pausedTables.get(this.id);
      // Clean refusals (nothing sent) may be retried from a fresh reading, but not forever.
      this.refusalsInRow = x.status === 'confirmed' ? 0 : (this.refusalsInRow || 0) + 1;
      if (!this.paused && this.refusalsInRow >= this.opt.maxRefusalsInRow) this.pause(this.refusalsInRow + ' actions in a row could not be executed (last: ' + (x.reason || x.status) + ')');
      return { kind: 'acted', entry };
    }
    async run(untilMs, onStep) {
      while (!this.stopped && mono() < untilMs) {
        let r; try { r = await this.step(); } catch (e) { this.m.errors++; r = { kind: 'error', reason: e.message }; this._diag('system', { ok: false, error: e.message }); }
        if (onStep) onStep(r);
        if (r.kind === 'paused' || r.kind === 'stopped') { if (this.opt.stopOnPause !== false) break; await sleep(250); }
        else if (r.kind !== 'acted') await sleep(this.opt.idlePollMs);
      }
    }
    stop() { this.stopped = true; }
    report() {
      const st = SCH.stats; return { table: this.id, hwnd: this.win.hwnd, paused: this.paused, counts: { frames: this.m.frames, rejectedFrames: this.m.rejectedFrames, decisions: this.m.decisions, solverDecisions: this.m.solver, scriptedDecisions: this.m.scripted, unavailable: this.m.unavailable, attempted: this.m.attempted, confirmed: this.m.confirmed, rejected: this.m.rejected, ambiguous: this.m.ambiguous, timedOut: this.m.timedOut, cancelled: this.m.cancelled, blocked: this.m.blocked, deadlineMisses: this.m.deadline, focusErrors: this.m.focusErrors, driverErrors: this.m.driverErrors, errors: this.m.errors },
        latencyMs: { endToEnd: st(this.m.e2e), cursorTravel: st(this.m.cursor), inputOperation: st(this.m.input), confirmation: st(this.m.confirmMs) }, executor: this.executor.counts, capture: { frames: this.capture.frames, failures: this.capture.failures } };
    }
  }

  /** Authorisation records: the QA one (executor) and the simulator one (driver: executable name + SHA-256). Max 8 hours. */
  function authorizations({ environment, approvedBy, exeFileName, exeSha256, hours = 2 }) {
    const expires = Date.now() + Math.min(8, hours) * 3600e3 - 60e3;
    return {
      qa: { format: 'eightmax-qa-authorization', version: 1, environment, approvedBy, testEnvironmentOnly: true, noRealMoney: true, operatorOwnsTestClient: true, expiresAt: expires, endpoint: 'http://127.0.0.1:48713/api/input/command' },
      simulator: { format: 'eightmax-simulator-authorization', version: 1, operatorOwnsSimulator: true, testEnvironmentOnly: true, noRealMoney: true, expiresAtUnixMs: expires, executable: { fileName: exeFileName, sha256: exeSha256 } },
    };
  }
  return { HostApi, hostSession, HostWindowCapture, tableReader, SimulatorTable, authorizations, DEFAULTS };
});
