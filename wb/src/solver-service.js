/* EightMax Test Workbench 0.21: solver adapter, decision source and bounded request service.
 *
 * Honest scope: the bundled engine is EightMax 5.1 (build 7d08acc7eb4577ee). The only
 * state-to-solver mapping implemented and verified is the eight-handed 25 BB preflop push/fold
 * study ("preflop-shove") with exact action-path matching. Any state outside a trained study's
 * exact root is answered "unavailable"; this module never substitutes a scripted action and never
 * labels a result GTO-certified.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./hand-state.js'));
  else root.WorkbenchSolverService = factory(root.WorkbenchHandState);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (HS) {
  'use strict';

  const PROTOCOL = 1;
  const SUPPORTED_ENGINES = Object.freeze([{ version: '5.1', build: '7d08acc7eb4577ee' }]);
  const CAPABILITIES = Object.freeze({
    protocol: PROTOCOL,
    queries: ['preflop-shove-root-and-path'], // verified
    unsupported: ['postflop-live-state', 'weighted-input-ranges-from-live-state', 'multiple-bet-sizes-from-live-state', 'per-hand-action-ev', 'gpu'],
    seats: 8, units: '100 chips = 1 BB', certification: 'none',
  });
  const ok = (x, m) => { if (!x) throw new Error(m); };

  /** Validate an engine descriptor against supported builds. Unknown builds are refused, never assumed compatible. */
  function identifyEngine(descriptor, provenance) {
    const issues = [];
    if (!descriptor || typeof descriptor.version !== 'string' || !/^[0-9a-f]{16}$/.test(descriptor.build || '')) issues.push('Engine descriptor lacks version or 16-hex build fingerprint');
    else if (!SUPPORTED_ENGINES.some((e) => e.version === descriptor.version && e.build === descriptor.build)) issues.push('Unsupported engine ' + descriptor.version + ' build ' + descriptor.build + '; falling back to validated 5.1');
    if (provenance && descriptor && (provenance.version !== descriptor.version || provenance.build !== descriptor.build)) issues.push('Provenance record disagrees with engine descriptor');
    return { compatible: issues.length === 0, engine: descriptor || null, issues, fallback: SUPPORTED_ENGINES[0] };
  }

  /** Capability negotiation: the engine offers a protocol range and query list; we require ours. */
  function negotiate(offer) {
    const o = offer || {};
    const protoOk = Number.isInteger(o.protocolMin) && Number.isInteger(o.protocolMax) && o.protocolMin <= PROTOCOL && PROTOCOL <= o.protocolMax;
    const missing = CAPABILITIES.queries.filter((q) => !(o.queries || []).includes(q));
    const reasons = [];
    if (!protoOk) reasons.push('Protocol ' + PROTOCOL + ' is outside the offered range');
    if (missing.length) reasons.push('Engine does not offer: ' + missing.join(', '));
    return { agreed: reasons.length === 0, protocol: PROTOCOL, capabilities: CAPABILITIES, reasons };
  }

  function validateRequest(r) {
    ok(r && r.format === 'eightmax-decision-request' && r.version === 1, 'Not a decision request');
    ok(Number.isInteger(r.table) && r.table >= 1 && r.table <= 10, 'Invalid table');
    ok(Number.isInteger(r.revision) && r.revision >= 0, 'Invalid state revision');
    ok(typeof r.stateKey === 'string' && r.stateKey.length > 0 && r.stateKey.length < 400, 'Invalid state key');
    ok(Number.isInteger(r.actor) && r.actor >= 0 && r.actor < 8, 'Invalid actor');
    ok(Array.isArray(r.holeCards) && r.holeCards.length === 2 && r.holeCards.every((c) => Number.isInteger(c) && c >= 0 && c < 52) && r.holeCards[0] !== r.holeCards[1], 'Hole cards missing or invalid');
    ok(Array.isArray(r.board) && r.board.length <= 5, 'Invalid board');
    ok(Array.isArray(r.actions) && r.actions.length <= 64, 'Action history missing or too long');
    ok(Array.isArray(r.stacks) && r.stacks.length === 8 && r.stacks.every((s) => Number.isInteger(s) && s >= 0), 'Stacks must list eight seats');
    ok(Number.isInteger(r.priority) && r.priority >= 0 && r.priority <= 3, 'Priority must be 0 (urgent) to 3');
    ok(Number.isFinite(r.deadlineMs) && r.deadlineMs > 0 && r.deadlineMs <= 60000, 'Deadline must be 1 to 60000 ms');
    return r;
  }

  /** Build a request from an accepted reconstructed state. Refuses states missing information. */
  function requestFromState(state, options = {}) {
    ok(state && state.status === 'playing' && state.legal, 'No decision is pending in this state');
    const me = state.seats[state.actor];
    ok(me.cards, 'Acting seat hole cards are not available');
    ok(state.actions, 'Complete action history is required');
    return validateRequest({
      format: 'eightmax-decision-request', version: 1, table: state.table, hand: state.hand, revision: state.revision,
      stateKey: state.key, street: state.street, actor: state.actor, button: state.button, holeCards: me.cards.slice(),
      board: state.board.slice(), actions: state.actions.map((a) => ({ seat: a.seat, type: a.type, amount: a.amount === undefined ? 0 : a.amount })),
      stacks: state.seats.map((p) => p.stack + (p.total === null ? p.bet : p.total)),
      toCall: state.legal.toCall, priority: options.priority === undefined ? 2 : options.priority,
      deadlineMs: options.deadlineMs || 2000,
    });
  }

  /**
   * Decision source backed by a trained EightMax study (prepared = study-adapter.prepare()).
   * `EM` is the engine library (parseCard etc). Only the preflop push/fold configuration is mapped.
   */
  class StudyDecisionSource {
    constructor(EM, prepared, options = {}) {
      this.EM = EM; this.prepared = prepared;
      const cfg = prepared.options.config;
      ok(cfg.preflop && cfg.preflop.mode === 'shove' && cfg.stacks.length === 8 && (cfg.board || '') === '', 'Only the eight-seat preflop push/fold study is mapped');
      ok(cfg.stacks.every((s) => s === cfg.stacks[0]), 'Mapping requires equal stacks');
      this.stack = Math.round(cfg.stacks[0] * 100);
      this.id = options.studyId || 'study'; this.nodes = new Map();
      this.convergence = options.convergence || { verdict: 'unproven', detail: 'No convergence check attached; training length alone proves nothing.' };
      this.engine = { version: '5.1', build: '7d08acc7eb4577ee', backend: 'javascript-reference-cpu' };
      this.updates = prepared.game.iterations;
      this.handIndex = new Map(prepared.spec.hands.map((rows) => new Map(rows.map((r) => [Math.min(r[1], r[2]) * 64 + Math.max(r[1], r[2]), r]))).entries());
    }
    studySeat(simSeat, button) { const bb = (button + 2) % 8; return (simSeat - (bb + 1) + 16) % 8; }
    _row(studySeat, simCards) {
      const ids = simCards.map((c) => this.EM.parseCard(HS.cardToString(c)));
      return this.handIndex.get(studySeat).get(Math.min(...ids) * 64 + Math.max(...ids)) || null;
    }
    /** Node structure (kind, seat, action labels) is a pure function of the path; building it costs ~25 ms, so memoise. */
    _node(steps) {
      const k = steps.join(',');
      let n = this.nodes.get(k);
      if (!n) { const v = this.prepared.game.view(steps); n = { kind: v.kind, seat: v.seat, labels: v.actions ? v.actions.map((a) => a.label) : [] }; this.nodes.set(k, n); }
      return n;
    }
    /** Walk the action history through the study tree. Returns the path key or a reason it cannot map. */
    _path(req) {
      const steps = [];
      let key = 'r';
      for (const a of req.actions) {
        const v = this._node(steps);
        if (v.kind !== 'player') return { error: 'History continues past the study tree' };
        if (this.studySeat(a.seat, req.button) !== v.seat) return { error: 'History actor does not match the study order' };
        let slot = -1;
        if (a.type === 'fold') slot = v.labels.findIndex((x) => x === 'Fold');
        else if (a.type === 'call') slot = v.labels.findIndex((x) => /^Call/.test(x));
        else if (a.type === 'allin' || a.type === 'raise') slot = v.labels.findIndex((x) => /^All-in/.test(x));
        if (slot < 0) return { error: 'Action "' + a.type + '" has no counterpart in the study menu' };
        steps.push(slot); key += slot;
      }
      return { steps, key };
    }
    decide(req) {
      validateRequest(req);
      const base = { format: 'eightmax-decision', version: 1, table: req.table, hand: req.hand, revision: req.revision, stateKey: req.stateKey, source: 'eightmax-study', studyId: this.id, engine: this.engine, trainingUpdates: this.updates, convergence: this.convergence, certification: 'none', assumptions: ['8-handed, equal ' + this.stack / 100 + ' BB stacks, SB 0.5 / BB 1 / ante 0.1 BB', 'Push/fold abstraction: only Fold and All-in/Call are modelled', 'Opponent ranges are the study ranges, not observed ranges'], warnings: [] };
      if (req.board.length) return { ...base, status: 'unavailable', reason: 'Study covers preflop only' };
      if (!req.stacks.every((s) => s === this.stack)) return { ...base, status: 'unavailable', reason: 'Stacks differ from the study root (' + this.stack / 100 + ' BB each)' };
      const p = this._path(req);
      if (p.error) return { ...base, status: 'unavailable', reason: p.error };
      const v = this._node(p.steps);
      if (v.kind !== 'player') return { ...base, status: 'unavailable', reason: 'Study node is not a decision' };
      const seat = this.studySeat(req.actor, req.button);
      if (seat !== v.seat) return { ...base, status: 'unavailable', reason: 'Acting seat does not match the study node' };
      const row = this._row(seat, req.holeCards);
      if (!row) return { ...base, status: 'unavailable', reason: 'Hand is not in the study range' };
      const probs = this.prepared.game.averageAt(p.key, [], seat, { id: row[0], a: row[1], b: row[2], w: row[3] });
      if (!probs) return { ...base, status: 'unavailable', reason: 'No stored strategy for this hand at ' + p.key + '; more training coverage is needed (no fallback taken)' };
      const labels = v.labels, mix = Array.from(probs);
      if (mix.length !== labels.length || mix.some((x) => !Number.isFinite(x) || x < -1e-9)) return { ...base, status: 'error', reason: 'Strategy/menu mismatch' };
      const best = mix.indexOf(Math.max(...mix));
      if (this.updates < 1000) base.warnings.push('Fewer than 1,000 training updates: strategy is likely far from equilibrium');
      if (this.convergence.verdict !== 'within-target') base.warnings.push('Convergence is ' + this.convergence.verdict + '; do not treat as equilibrium play');
      return {
        ...base, status: 'ok', path: p.key, labels, probabilities: mix, recommended: labels[best], recommendedSlot: best,
        evByAction: null, evNote: 'Per-hand action EV is not exposed by the reference path; node-average EVs are range-wide and omitted.',
        executable: labels.map((l) => /^Fold/.test(l) ? { type: 'fold' } : /^Call/.test(l) ? { type: 'call' } : { type: 'allin' }),
      };
    }
  }

  const clone = (x) => JSON.parse(JSON.stringify(x));
  function stableKey(req) {
    // Exact-input key: everything the answer depends on, nothing it does not (table/revision excluded on purpose).
    return JSON.stringify([req.street, req.button, req.actor, req.holeCards, req.board, req.actions, req.stacks]);
  }

  class SolverService {
    /**
     * options: decide(request, ctx)->decision|Promise, currentRevision(table)->number,
     *   maxQueue, workers, cacheBytes, maxPending (per table), now(), setTimeout/clearTimeout, memoryPressure()->0..1
     */
    constructor(options) {
      ok(options && typeof options.decide === 'function', 'A decide function is required');
      this.o = {
        maxQueue: 64, workers: 2, cacheBytes: 4 * 1024 * 1024, maxPending: 1, now: () => Date.now(),
        setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t), memoryPressure: () => 0,
        currentRevision: () => undefined, ...options,
      };
      this.queue = []; this.active = new Map(); this.cache = new Map(); this.cacheSize = 0; this.seq = 0;
      this.stats = { submitted: 0, ok: 0, unavailable: 0, cacheHits: 0, cancelled: 0, stale: 0, timeout: 0, rejected: 0, error: 0, overflow: 0, evicted: 0 };
      this.stopped = false;
    }
    _finish(job, result) {
      if (job.done) return; job.done = true;
      if (job.timer) this.o.clearTimeout(job.timer);
      this.active.delete(job.id);
      const key = result.status;
      this.stats[key] = (this.stats[key] || 0) + 1;
      job.resolve({ ...result, table: job.req.table, revision: job.req.revision, queuedMs: job.startedAt - job.queuedAt, latencyMs: this.o.now() - job.queuedAt });
      this._pump();
    }
    /** Returns a promise of {status:'ok'|'unavailable'|'cancelled'|'stale'|'timeout'|'rejected'|'error', decision?}. */
    submit(req) {
      this.stats.submitted++;
      try { validateRequest(req); } catch (e) { this.stats.rejected++; return Promise.resolve({ status: 'rejected', reason: e.message, table: req && req.table }); }
      if (this.stopped) return Promise.resolve({ status: 'cancelled', reason: 'Solver service stopped', table: req.table });
      // A newer request for the same table makes every older one obsolete.
      for (const j of this.queue.slice()) if (j.req.table === req.table && j.req.revision < req.revision) this._cancelJob(j, 'Superseded by revision ' + req.revision);
      for (const j of this.active.values()) if (j.req.table === req.table && j.req.revision < req.revision) this._cancelJob(j, 'Superseded by revision ' + req.revision);
      const pendingForTable = this.queue.filter((j) => j.req.table === req.table).length + [...this.active.values()].filter((j) => j.req.table === req.table).length;
      if (pendingForTable >= this.o.maxPending) { this.stats.overflow++; return Promise.resolve({ status: 'rejected', reason: 'Table already has ' + pendingForTable + ' pending decision(s)', table: req.table }); }
      if (this.queue.length >= this.o.maxQueue) { this.stats.overflow++; return Promise.resolve({ status: 'rejected', reason: 'Solver queue full (' + this.queue.length + ')', table: req.table }); }
      return new Promise((resolve) => {
        const job = { id: ++this.seq, req, resolve, queuedAt: this.o.now(), startedAt: 0, done: false, timer: null, cancelled: false };
        this.queue.push(job);
        this.queue.sort((a, b) => a.req.priority - b.req.priority || a.id - b.id);
        this._pump();
      });
    }
    _cancelJob(job, reason) {
      job.cancelled = true;
      const i = this.queue.indexOf(job); if (i >= 0) this.queue.splice(i, 1);
      this._finish(job, { status: 'cancelled', reason });
    }
    cancelTable(table, reason = 'Cancelled') {
      for (const j of this.queue.slice()) if (j.req.table === table) this._cancelJob(j, reason);
      for (const j of [...this.active.values()]) if (j.req.table === table) this._cancelJob(j, reason);
    }
    stop() { this.stopped = true; for (const j of this.queue.slice()) this._cancelJob(j, 'Solver service stopped'); for (const j of [...this.active.values()]) this._cancelJob(j, 'Solver service stopped'); }
    _pump() {
      while (!this.stopped && this.active.size < this.o.workers && this.queue.length) {
        const job = this.queue.shift(); job.startedAt = this.o.now(); this.active.set(job.id, job);
        const hit = this._cacheGet(job.req);
        if (hit) { this.stats.cacheHits++; Promise.resolve().then(() => this._complete(job, hit, true)); continue; }
        job.timer = this.o.setTimeout(() => this._finish(job, { status: 'timeout', reason: 'No answer within ' + job.req.deadlineMs + ' ms' }), job.req.deadlineMs);
        // Yield to the event loop first so a burst of ten tables cannot monopolise it.
        Promise.resolve().then(() => new Promise((r) => (typeof setImmediate === 'function' ? setImmediate(r) : setTimeout(r, 0)))).then(() => {
          if (job.done) return null;
          return this.o.decide(clone(job.req), { cancelled: () => job.cancelled || job.done });
        }).then((d) => { if (!job.done) this._complete(job, d, false); }, (e) => this._finish(job, { status: 'error', reason: String(e && e.message || e) }));
      }
    }
    _complete(job, decision, fromCache) {
      if (job.done) return;
      const current = this.o.currentRevision(job.req.table);
      if (current !== undefined && current !== job.req.revision) return this._finish(job, { status: 'stale', reason: 'State moved from revision ' + job.req.revision + ' to ' + current + '; decision discarded' });
      if (!decision || !decision.status) return this._finish(job, { status: 'error', reason: 'Malformed solver response' });
      if (decision.status !== 'ok') return this._finish(job, { status: decision.status === 'unavailable' ? 'unavailable' : 'error', reason: decision.reason, decision });
      if (decision.stateKey !== job.req.stateKey) return this._finish(job, { status: 'stale', reason: 'Response bound to a different state key' });
      if (!fromCache) this._cachePut(job.req, decision);
      const d = { ...clone(decision), actor: job.req.actor, table: job.req.table, revision: job.req.revision, stateKey: job.req.stateKey, issuedAt: this.o.now(), fromCache };
      this._finish(job, { status: 'ok', decision: d });
    }
    _cacheGet(req) {
      const k = stableKey(req), e = this.cache.get(k); if (!e) return null;
      this.cache.delete(k); this.cache.set(k, e); // LRU touch
      return { ...clone(e.decision), stateKey: req.stateKey };
    }
    _cachePut(req, decision) {
      const k = stableKey(req), size = (k.length + JSON.stringify(decision).length) * 2;
      let budget = this.o.cacheBytes; const pressure = this.o.memoryPressure();
      if (pressure > 0.85) budget = Math.floor(budget * 0.25); // memory-aware shrink
      if (size > budget) return;
      const old = this.cache.get(k); if (old) { this.cacheSize -= old.size; this.cache.delete(k); }
      this.cache.set(k, { decision: clone(decision), size }); this.cacheSize += size;
      while (this.cacheSize > budget && this.cache.size) {
        const first = this.cache.keys().next().value, e = this.cache.get(first);
        this.cache.delete(first); this.cacheSize -= e.size; this.stats.evicted++;
      }
    }
    info() { return { queued: this.queue.length, active: this.active.size, cacheEntries: this.cache.size, cacheBytes: this.cacheSize, stats: { ...this.stats } }; }
  }

  return { PROTOCOL, SUPPORTED_ENGINES, CAPABILITIES, identifyEngine, negotiate, validateRequest, requestFromState, StudyDecisionSource, SolverService, stableKey };
});
