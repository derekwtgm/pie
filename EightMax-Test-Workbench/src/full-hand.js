/* EightMax Test Workbench 0.24: one controlled table, end to end.
 *
 *   screen capture -> image recognition -> hand-state reconstruction -> EightMax decision
 *     -> validated action -> acknowledgement from the NEXT screen reading -> updated game state
 *
 * The decision loop reads ONLY pixels (plus the client's revision counter, which a window title or status line
 * could carry); it never reads the simulator's internal state. The oracle table is touched only to start hands
 * and, in tests, to audit the outcome afterwards. Decisions come from a decision source; scripted fallbacks are
 * possible only when explicitly allowed, are labelled SCRIPTED, and are counted apart from solver decisions.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./hand-state.js'), require('./solver-service.js'), require('./test-executor.js'), require('./screen-capture.js'), require('./vision-ocr.js'), require('./sim-display.js'), require('./vision-track.js'), require('./multitable.js'));
  else root.WorkbenchFullHand = factory(root.EightMax, root.WorkbenchHandState, root.WorkbenchSolverService, root.WorkbenchExecutor, root.WorkbenchCapture, root.WorkbenchVisionOcr, root.WorkbenchSimDisplay, root.WorkbenchVisionTrack, root.WorkbenchMultiTable);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (EM, HS, SS, EX, CAP, OCR, SIM, TRK, MT) {
  'use strict';

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ok = (x, m) => { if (!x) throw new Error(m); };

  /** The offline controlled poker client: a table, a window that shows it, and an action interface. */
  class OfflineClient {
    constructor(table, options = {}) {
      this.table = table; this.width = options.width || 960; this.noise = options.noise || 0; this.lastView = 0; this.renderOpts = options.render || {};
      this.stackPolicy = options.stackPolicy || null; this.stackRng = new EM.RNG((options.stackSeed || table.id * 977) >>> 0);
      this.source = new CAP.SimulatedWindowSource((w, id) => this._render(w, id), { width: this.width, title: 'EightMax controlled client — table ' + table.id, hwnd: 0x2000 + table.id, clock: options.clock });
      this.adapter = new EX.SimulatorAdapter(table, () => 0);
    }
    _render(w, id) {
      const t = this.table; if (t.actor >= 0 && t.status === 'playing') this.lastView = t.actor;
      const img = SIM.renderTable(t, w, { v2: true, heroSeat: this.lastView, noise: this.noise, seed: (id * 2654435761) >>> 0, ...this.renderOpts });
      img.viewSeat = this.lastView; img.clientRevision = t.revision; return img;
    }
    newHand() { if (this.stackPolicy) this.table.setNextStacks(this.stackPolicy(this.stackRng, this.table.hand + 1)); this.table.startHand(); }
    /** Restart support (in-process): replace the oracle table with a restored copy. */
    restoreTable(captured, seed) { this.table = MT.restoreTable(captured, seed || 1); this.table.paused = false; this.adapter = new EX.SimulatorAdapter(this.table, () => 0); this.source.render = (w, id) => this._render(w, id); }
    get status() { return this.table.status; }
  }

  /** Variable stack depths for stress runs: each seat 2.1 to 90 BB, with some very short stacks (all-ins and side pots follow naturally). */
  function variableStacks(rng) { const pool = [210, 300, 450, 700, 1000, 1500, 2500, 4000, 6000, 9000]; return Array.from({ length: 8 }, () => pool[Math.floor(rng.next() * pool.length)]); }

  /** Vision kit: templates calibrated on clean renders of the controlled client (v2 layout). */
  const calCache = new Map();
  function makeVision(table, widths) {
    const layout = SIM.L2, key = (widths || []).join(',') || 'default'; let cal = calCache.get(key);
    if (!cal) { cal = SIM.calibrate(widths || [800, 960, 1280, 1440, 1920], layout); calCache.set(key, cal); }
    return new OCR.ImageObserver({ table, profiles: cal.profiles, cards: cal.cards, glyphs: cal.glyphs });
  }

  /** Scripted test policy for a reconstructed state. Never presented as a solver decision. */
  function scriptedDecision(state, rng, menu) {
    const l = state.legal, r = rng.next(); let a, onTree = false;
    // 0.25: when the solver could identify the tree node but not the hand, stay ON the tree: choose among the menu's legal entries so later decisions remain answerable.
    if (menu && Array.isArray(menu.executable)) {
      const legal = menu.executable.filter((e) => e && (e.type === 'fold' ? l.toCall > 0 : e.type === 'check' ? l.canCheck : e.type === 'call' ? l.toCall > 0 : e.type === 'allin' ? l.canRaise : (l.canRaise && e.amount >= l.minRaiseTo && e.amount <= l.maxRaiseTo)));
      const passive = legal.filter((e) => e.type === 'check' || e.type === 'call'), agg = legal.filter((e) => e.type === 'bet' || e.type === 'raise'), fold = legal.find((e) => e.type === 'fold');
      if (agg.length && r > 0.8) { const pick = agg[Math.floor(rng.next() * agg.length)]; a = { type: state.currentBet > 0 ? 'raise' : 'bet', amount: pick.amount }; onTree = true; } else if (fold && l.toCall > 0 && r < 0.22) { a = fold; onTree = true; } else if (passive.length) { a = passive[0]; onTree = true; }
    }
    if (!a) {
      if (l.canRaise && r > 0.8) a = { type: state.currentBet === 0 && state.street !== 'preflop' ? 'bet' : 'raise', amount: Math.min(l.maxRaiseTo, Math.max(l.minRaiseTo, state.currentBet + Math.floor((state.pot * 0.5) / 25) * 25)) };
      else if (l.toCall > 0 && r < 0.22) a = { type: 'fold' };
      else a = { type: l.canCheck ? 'check' : 'call' };
    }
    return { format: 'eightmax-decision', version: 1, status: 'ok', source: 'scripted-fallback', label: 'SCRIPTED FALLBACK — not a solver decision', table: state.table, hand: state.hand, revision: state.revision, stateKey: state.key, actor: state.actor, issuedAt: Date.now(), labels: [a.type], probabilities: [1], recommended: a.type, recommendedSlot: 0, executable: [a], certification: 'none', onTree };
  }

  const sameAction = (done, h) => h && h.seat === done.seat && ((done.type === 'raise') ? (['bet', 'raise', 'allin'].includes(h.type) && h.amount === done.amount) : h.type === done.type);

  class SingleTablePipeline {
    /**
     * options: table (oracle, only to start hands), client, vision (ImageObserver), decisionSource, mode ('simulation'|'study'),
     *   allowScripted, scriptedWhen(state)->bool (labelled scripted choice even when the solver could answer), deadlineMs,
     *   engineOptions, seed, maxFrameRetries, select, solverOptions, executorOptions
     */
    constructor(o) {
      ok(o && o.client && o.vision && o.decisionSource, 'client, vision and decisionSource are required');
      this.o = { mode: 'simulation', allowScripted: false, scriptedWhen: null, deadlineMs: 20000, maxFrameRetries: 6, select: 'recommended', seed: 1, ...o };
      this.client = o.client; this.table = o.table || o.client.table || null; this.id = o.tableId || (this.table && this.table.id) || 1; this.vision = o.vision;
      this.engine = new HS.HandStateEngine(this.id, { track: true, expectedLayout: 'eightmax-8max-v2', ...(o.engineOptions || {}) });
      this.session = new CAP.CaptureSession(o.client.source, { intervalMs: 1, settleFrames: 1, maxFrameAgeMs: 5000, ...(o.captureOptions || {}) });
      this.solver = new SS.SolverService({ decide: (req) => this.o.decisionSource.decide(req), workers: 1, maxQueue: 8, maxPending: 1, cacheBytes: 2 * 1024 * 1024, currentRevision: () => (this.engine.state ? this.engine.revision : undefined), ...(o.solverOptions || {}) });
      this.executor = new EX.TestExecutor({ stateOf: () => ({ state: this.engine.state, paused: this.engine.paused, pauseReason: this.engine.pauseReason, revision: this.engine.revision }), now: () => Date.now(), maxActionAgeMs: 600000, hrnow: now, ...(o.executorOptions || {}) });
      this.executor.setMode(this.o.mode, { authorization: this.o.authorization }); this.executor.attach(this.id, o.client.adapter);
      if (this.o.checkpoint) { this.engine.restoreCheckpoint(this.o.checkpoint.engine); this.o.resume = true; }
      this.rng = new EM.RNG(this.o.seed); this.hands = []; this.cur = null; this.stopped = false;
      this.totals = { hands: 0, solverActions: 0, scriptedActions: 0, rejectedFrames: 0, invalidCaptures: 0, suspended: 0, unavailable: 0, staleDecisions: 0, ackMismatches: 0, duplicateBlocked: 0 };
      this.lat = { capture: [], recognise: [], reconstruct: [], solve: [], execute: [], cycle: [] };
      this.unavailableReasons = new Map(); this.unavailableCodes = {};
    }
    emit(kind, data) { if (typeof this.o.onEvent === 'function') { try { this.o.onEvent(kind, data); } catch (e) { /* observers must never break the loop */ } } }
    /** Everything needed to continue after a restart: reconstruction state and (for the in-process client) the oracle table. */
    checkpoint() { return { format: 'eightmax-pipeline-checkpoint', version: 1, table: this.id, engine: this.engine.exportCheckpoint(), oracle: this.table ? MT.captureTable(this.table) : null, totals: { ...this.totals } }; }
    emergencyStop(reason = 'Emergency stop') { this.stopped = true; this.executor.emergencyStop(reason); this.solver.stop(); }

    /** Capture + read + reconstruct one frame. Returns {state} | {reject}. */
    async look() {
      const t0 = now(); let frame = await this.session.tick();
      // Optional animation guard: the screen must stop changing for N frames before it is read (real clients animate dealing and chip movement).
      if (this.o.stability && frame && frame.valid) {
        this.gate = this.gate || new TRK.StabilityGate(this.o.stability); let g = this.gate.push(frame.image), tries = 0;
        while (!g.stable && tries++ < (this.o.stability.maxWaitFrames || 6)) { if (this.o.stability.waitMs) await sleep(this.o.stability.waitMs); frame = await this.session.tick(); if (!frame || !frame.valid) break; g = this.gate.push(frame.image); }
        if (frame && frame.valid && !g.stable) { this.totals.animating = (this.totals.animating || 0) + 1; this.lat.capture.push(now() - t0); return { reject: 'animating: the table did not settle (' + (g.changedFraction * 100).toFixed(2) + '% of pixels still changing)' }; }
      }
      this.lat.capture.push(now() - t0);
      if (!frame || !frame.valid) { this.totals.invalidCaptures++; return { reject: 'capture ' + (frame && frame.code) + ': ' + (frame && frame.reason) }; }
      const t1 = now(), r = this.vision.observe(frame.image, { heroSeat: frame.viewSeat, capturedAt: frame.tMs, seq: frame.seq });
      this.lat.recognise.push(now() - t1);
      this.emit('frame', { frame });
      if (!r.ok) { this.totals.rejectedFrames++; this.emit('rejected', { reasons: r.reasons }); return { reject: 'vision: ' + r.reasons.join('; '), reads: r.reads }; }
      if (frame.clientRevision !== undefined) r.observation.simRevision = frame.clientRevision;
      const t2 = now(), x = this.engine.ingest(r.observation); this.lat.reconstruct.push(now() - t2);
      this.emit('observation', { observation: r.observation, reads: r.reads, accepted: x.accepted, issues: x.issues });
      if (!x.accepted) { this.totals.rejectedFrames++; return { reject: 'state: ' + x.issues.map((i) => i.code + ' ' + i.detail).join('; '), issues: x.issues }; }
      return { state: x.state, accepted: x, frame, observation: r.observation };
    }

    /** Play one hand to settlement (or until it must be suspended). Returns the hand record. */
    async playHand() {
      const tHand = now(); if (this.o.resume && !this._resumed) this._resumed = true; else await this.client.newHand();
      const rec = this.cur = { hand: null, actions: [], rejections: [], status: 'running', reason: null, solverActions: 0, scriptedActions: 0, startedAt: Date.now() };
      let retries = 0, pendingAck = null, staleRun = 0;
      while (!this.stopped) {
        const tc = now(); const v = await this.look();
        if (!v.state) {
          rec.rejections.push(v.reject); if (++retries > this.o.maxFrameRetries) return this._end(rec, 'suspended', 'Could not obtain a consistent reading: ' + v.reject, tHand);
          await sleep(1); continue;
        }
        if (this.engine.paused) { rec.rejections.push('table paused: ' + this.engine.pauseReason); if (++retries > this.o.maxFrameRetries + 4) return this._end(rec, 'suspended', 'Table stayed paused: ' + this.engine.pauseReason, tHand); await sleep(1); continue; }
        retries = 0; const st = v.state; if (rec.hand === null) rec.hand = st.hand;
        this.emit('state', { state: st });
        if (this.o.stepDelayMs) await sleep(this.o.stepDelayMs);
        if (pendingAck) {
          const h = st.actions && st.actions[st.actions.length - 1];
          const done = pendingAck; pendingAck = null;
          if (!(st.revision > done.revision) && st.status !== 'complete') { this.totals.ackMismatches++; return this._end(rec, 'suspended', 'Screen did not change after the action was accepted', tHand); }
          if (st.actions.length < done.count + 1 || !sameAction(done.action, st.actions[done.count])) { this.totals.ackMismatches++; return this._end(rec, 'suspended', 'Next screen reading shows ' + JSON.stringify(st.actions[done.count] || null) + ' instead of the executed ' + JSON.stringify(done.action), tHand); }
          done.action.acked = true;
        }
        if (st.status === 'complete') {
          const cs = st.settlement || { ok: false };
          rec.final = st.seats.map((p) => p.stack); rec.settlementOk = cs.ok; rec.board = st.board.slice();
          return this._end(rec, cs.ok ? 'complete' : 'suspended', cs.ok ? null : 'Settlement check failed: ' + (cs.reasons || []).join('; '), tHand);
        }
        // ---- decide ----
        const useScripted = this.o.scriptedWhen && this.o.scriptedWhen(st);
        let decision = null, via = 'solver';
        const tS = now();
        if (!useScripted) {
          let req; try { req = SS.requestFromState(st, { priority: 1, deadlineMs: this.o.deadlineMs }); } catch (e) { return this._end(rec, 'suspended', 'Cannot form a decision request: ' + e.message, tHand); }
          const res = await this.solver.submit(req); this.lat.solve.push(now() - tS);
          if (res.status === 'ok') { decision = res.decision; staleRun = 0; }
          else if (res.status === 'stale' || res.status === 'cancelled') { this.totals.staleDecisions++; if (++staleRun > 4) return this._end(rec, 'suspended', 'Decisions kept going stale (' + res.reason + ')', tHand); if (this.stopped) break; continue; }
          else {
            if (res.status === 'unavailable') { this.totals.unavailable++; this.unavailableReasons.set(res.reason, (this.unavailableReasons.get(res.reason) || 0) + 1); const c = (res.decision && res.decision.code) || 'unsupported-state'; this.unavailableCodes[c] = (this.unavailableCodes[c] || 0) + 1; }
            if (!this.o.allowScripted) return this._end(rec, 'suspended', 'Solver ' + res.status + ': ' + res.reason + ' (no fallback allowed)', tHand);
            decision = scriptedDecision(st, this.rng, res.decision && res.decision.treeMenu); via = 'scripted';
          }
        } else { decision = scriptedDecision(st, this.rng); via = 'scripted'; }
        this.emit('decision', { decision, via, state: st });
        if (this.o.mode === 'study') { rec.studyDecisions = (rec.studyDecisions || 0) + 1; return this._end(rec, 'observed', 'Study Mode: recommendation shown, nothing executed', tHand); }
        const count = st.actions.length, actor = st.actor, rev = st.revision, tX = now();
        let captured = null;
        const x = await this.executor.execute(decision, { select: this.o.select, allowScripted: via === 'scripted' });
        this.lat.execute.push(now() - tX); this.lat.cycle.push(now() - tc);
        if (x.status === 'duplicate') { this.totals.duplicateBlocked++; continue; }
        if (x.status !== 'confirmed') { if (x.status === 'aborted') return this._end(rec, 'stopped', 'Emergency stop', tHand); return this._end(rec, 'suspended', 'Action ' + x.status + ': ' + (x.reason || ''), tHand); }
        const act = { seat: actor, type: x.action.type, amount: x.action.amount }, entry = { seat: actor, street: st.street, type: x.action.type, label: x.abstractType || x.action.type, amount: x.action.amount || 0, source: via, translated: !!(decision.translations && decision.translations.length), onTree: via === 'scripted' ? !!decision.onTree : undefined, studyId: decision.studyId || null, path: decision.path || null, probabilities: decision.probabilities || null, labels: decision.labels || null, recommended: decision.recommended || null, submitMs: x.submitMs };
        this.emit('executed', { entry });
        rec.actions.push(entry); if (via === 'solver') { rec.solverActions++; this.totals.solverActions++; } else { rec.scriptedActions++; this.totals.scriptedActions++; }
        pendingAck = { action: act, count, revision: rev };
      }
      return this._end(rec, 'stopped', 'Emergency stop', tHand);
    }
    _end(rec, status, reason, t0) {
      rec.status = status; rec.reason = reason; rec.ms = now() - t0; this.emit('hand-end', { record: rec });
      if (status === 'suspended') this.totals.suspended++; if (status === 'complete') this.totals.hands++;
      this.hands.push(rec); return rec;
    }
    async run(n, onHand) {
      for (let i = 0; i < n && !this.stopped; i++) {
        const r = await this.playHand(); if (onHand) onHand(r);
        if (r.status !== 'complete') {
          // Controlled recovery: a suspended hand is abandoned by the operator layer only after the oracle shows nothing is in flight.
          if (this.o.stopOnSuspend !== false) break;
          this.engine.reset(); this.executor.resumeTable(this.id);
          if (this.table && this.table.status === 'playing') break;
        }
      }
      return this.report();
    }
    report() {
      const stats = (a) => { if (!a.length) return { n: 0 }; const s = a.slice().sort((x, y) => x - y), q = (p) => s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)]; return { n: s.length, mean: s.reduce((x, y) => x + y, 0) / s.length, p50: q(50), p95: q(95), p99: q(99), max: s[s.length - 1] }; };
      const sol = this.solver.info(), attribution = {};
      for (const h of this.hands) for (const a of h.actions) { const k = a.street + '/' + (a.source === 'solver' ? (a.translated ? 'solver-translated' : 'solver') : 'scripted'); attribution[k] = (attribution[k] || 0) + 1; }
      const cat = (r) => String(r).replace(/node r\d+/g, 'node <path>').replace(/\d+(\.\d+)?( bb)?/g, '#').slice(0, 160), why = new Map();
      for (const [r, n] of this.unavailableReasons) why.set(cat(r), (why.get(cat(r)) || 0) + n);
      return { table: this.id, totals: { ...this.totals }, hands: this.hands.length, completed: this.hands.filter((h) => h.status === 'complete').length, latencyMs: Object.fromEntries(Object.entries(this.lat).map(([k, v]) => [k, stats(v)])), capture: this.session.status(), solver: sol, executor: { counts: { ...this.executor.counts }, latency: this.executor.latencyStats() }, attribution, unavailableCodes: { ...this.unavailableCodes }, unavailable: [...why].sort((a, b) => b[1] - a[1]).map(([reason, n]) => ({ reason, n })), engine: { accepted: this.engine.accepted, rejected: this.engine.rejected } };
    }
  }

  return { OfflineClient, variableStacks, makeVision, scriptedDecision, SingleTablePipeline, sameAction };
});
