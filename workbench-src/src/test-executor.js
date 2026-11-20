/* EightMax Test Workbench 0.24 (from 0.22; 0.35: no blind retry of visible input, wager context, controlled-fixture scripted policy): guarded execution of validated solver decisions.
 *
 * Three separated modes. The default is "study": nothing is ever executed. "simulation" drives the
 * offline simulator only. "qa" needs an explicit authorization record naming an approved
 * test-client endpoint on this machine and refuses to run without it. There is no adapter for any
 * public or real-money poker client, and none will be accepted without that authorization.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WorkbenchExecutor = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MODES = Object.freeze(['study', 'simulation', 'qa']);
  const ACTIONS = Object.freeze(['fold', 'check', 'call', 'bet', 'raise', 'allin']);
  const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

  /** QA authorization: explicit, time-limited, loopback-only unless hosts are individually listed. */
  function validateAuthorization(a, now) {
    const issues = [];
    if (!a || a.format !== 'eightmax-qa-authorization' || a.version !== 1) return { valid: false, issues: ['No eightmax-qa-authorization v1 record'] };
    if (typeof a.environment !== 'string' || a.environment.length < 3) issues.push('Environment name missing');
    if (typeof a.approvedBy !== 'string' || a.approvedBy.length < 3) issues.push('Approver missing');
    if (a.testEnvironmentOnly !== true) issues.push('Record must state testEnvironmentOnly: true');
    if (a.noRealMoney !== true) issues.push('Record must state noRealMoney: true');
    if (a.operatorOwnsTestClient !== true) issues.push('Record must state operatorOwnsTestClient: true');
    if (!Number.isFinite(a.expiresAt) || a.expiresAt <= now) issues.push('Authorization expired or has no expiry');
    else if (a.expiresAt - now > 8 * 3600 * 1000) issues.push('Authorization may last at most 8 hours');
    let host = null;
    try { const u = new URL(a.endpoint); host = u.hostname; if (u.protocol !== 'http:' && u.protocol !== 'https:') issues.push('Endpoint must be http(s)'); } catch (e) { issues.push('Endpoint is not a valid URL'); }
    if (host && !LOOPBACK.has(host) && !(Array.isArray(a.allowedHosts) && a.allowedHosts.includes(host))) issues.push('Endpoint host ' + host + ' is not loopback and not individually allow-listed');
    return { valid: issues.length === 0, issues, host };
  }

  /** Simulator adapter: every action is also validated by the simulator's own stale/epoch/legal checks. */
  class SimulatorAdapter {
    constructor(table, clock) { this.kind = 'simulator'; this.table = table; this.clock = clock || (() => 0); this.id = 'simulator:' + table.id; }
    submit(act) {
      const t = this.table;
      const type = act.type === 'allin' || act.type === 'bet' ? 'raise' : act.type;
      const req = t.request(type, act.amount || 0, this.clock());
      // The request carries the table's *current* hand/revision/epoch. Staleness was already checked
      // against the decision's own revision by the executor; this binds the action to the real table.
      if (act.simRevision !== undefined && act.simRevision !== t.revision) return { accepted: false, reason: 'Simulator revision moved (' + act.simRevision + ' -> ' + t.revision + ')' };
      if (act.hand !== undefined && act.hand !== t.hand) return { accepted: false, reason: 'Simulator hand changed' };
      if (act.actor !== undefined && act.actor !== t.actor) return { accepted: false, reason: 'Simulator actor changed' };
      try { t.execute(req, this.clock()); } catch (e) { return { accepted: false, reason: e.message }; }
      return { accepted: true, simRevisionAfter: t.revision };
    }
  }

  /** Approved test-client adapter: POSTs JSON to the authorized endpoint with an idempotency key. */
  class ApprovedClientAdapter {
    constructor(authorization, now, transport) {
      const v = validateAuthorization(authorization, now);
      if (!v.valid) throw new Error('QA authorization refused: ' + v.issues.join('; '));
      this.kind = 'approved-client'; this.auth = authorization; this.id = 'qa:' + authorization.environment; this.transport = transport;
      if (typeof transport !== 'function') throw new Error('A transport function is required');
    }
    async submit(act) { return this.transport(this.auth.endpoint, { idempotencyKey: act.key, table: act.table, hand: act.hand, actor: act.actor, revision: act.simRevision, action: act.type, amount: act.amount }); }
  }

  /** Concrete legal action for a decision's abstract action, derived from the reconstructed state only. */
  function concretize(abstract, state) {
    const l = state && state.legal;
    if (!l) return { error: 'no-legal-actions' };
    switch (abstract.type) {
      case 'fold': return { type: 'fold', amount: 0 };
      case 'check': return l.canCheck ? { type: 'check', amount: 0 } : { error: 'check-not-legal' };
      case 'call': return l.toCall > 0 ? { type: 'call', amount: l.callAmount } : { error: 'nothing-to-call' };
      case 'allin': {
        const me = state.seats[state.actor];
        if (me.stack <= 0) return { error: 'no-chips' };
        if (l.toCall >= me.stack) return { type: 'call', amount: l.callAmount }; // all-in by calling
        if (!l.canRaise) return { error: 'raise-not-available' };
        return { type: 'raise', amount: l.maxRaiseTo };
      }
      case 'raise': case 'bet': {
        if (!l.canRaise) return { error: 'raise-not-available' };
        if (!l.exact) return { error: 'minimum-raise-unknown' };
        const to = abstract.amount;
        if (abstract.type === 'bet' && state.currentBet > 0) return { error: 'bet-facing-a-wager (use raise)' };
        if (abstract.type === 'raise' && state.currentBet === 0 && state.street !== 'preflop') return { error: 'raise-with-no-wager (use bet)' };
        if (!Number.isInteger(to) || to <= state.currentBet || to < l.minRaiseTo && to !== l.maxRaiseTo || to > l.maxRaiseTo) return { error: 'raise-size-illegal' };
        return { type: 'raise', amount: to };
      }
      default: return { error: 'unknown-action' };
    }
  }

  class TestExecutor {
    /**
     * options: stateOf(table)->{state,paused,revision}|null, now(), maxActionAgeMs, maxRetries, ackTimeoutMs, random
     */
    constructor(options) {
      this.o = { now: () => Date.now(), maxActionAgeMs: 1500, maxRetries: 2, ackTimeoutMs: 1000, random: Math.random, ...options };
      if (typeof this.o.stateOf !== 'function') throw new Error('stateOf is required');
      this.mode = 'study'; this.estop = null; this.adapters = new Map(); this.pausedTables = new Map();
      this.sent = new Set(); this.inflight = new Set(); this.log = []; this.counts = { executed: 0, scripted: 0, blocked: 0, rejected: 0, unconfirmed: 0 }; this.latencies = [];
    }
    setMode(mode, options = {}) {
      if (!MODES.includes(mode)) throw new Error('Unknown mode ' + mode);
      if (this.estop) throw new Error('Emergency stop latched; reset first');
      if (mode === 'qa') {
        const v = validateAuthorization(options.authorization, this.o.now());
        if (!v.valid) throw new Error('QA mode refused: ' + v.issues.join('; '));
        this.authorization = options.authorization;
      }
      this.mode = mode; this._log('mode', 0, mode);
    }
    attach(table, adapter) {
      if (this.mode === 'qa' && adapter.kind !== 'approved-client') throw new Error('QA mode accepts only approved-client adapters');
      if (this.mode === 'simulation' && adapter.kind !== 'simulator') throw new Error('Simulation mode accepts only simulator adapters');
      this.adapters.set(table, adapter);
    }
    pauseTable(table, reason) { this.pausedTables.set(table, reason); this._log('pause', table, reason); }
    resumeTable(table) { this.pausedTables.delete(table); this._log('resume', table, 'operator'); }
    emergencyStop(reason = 'Emergency stop') { this.estop = reason; this._log('estop', 0, reason); }
    reset() { this.estop = null; this.inflight.clear(); this._log('reset', 0, 'emergency stop cleared'); }
    _log(kind, table, detail, extra) { this.log.push({ seq: this.log.length + 1, at: this.o.now(), kind, table, detail, ...(extra || {}) }); if (this.log.length > 5000) this.log.shift(); }
    _block(table, why, kind = 'blocked') { this.counts[kind === 'rejected' ? 'rejected' : 'blocked']++; this._log(kind, table, why); return { status: kind, reason: why, table }; }

    /** Execute one solver decision. Resolves with {status:'confirmed'|'blocked'|'rejected'|'duplicate'|'unconfirmed'|'aborted'}. */
    async execute(decision, options = {}) {
      const table = decision && decision.table;
      if (this.estop) return this._block(table, 'Emergency stop: ' + this.estop);
      if (this.mode === 'study') return this._block(table, 'Study mode never executes actions');
      if (this.pausedTables.has(table)) return this._block(table, 'Table paused: ' + this.pausedTables.get(table));
      const adapter = this.adapters.get(table);
      if (!adapter) return this._block(table, 'No adapter attached to table ' + table + ' (unrecognised table)');
      if (this.mode === 'qa' && validateAuthorization(this.authorization, this.o.now()).valid === false) { this.emergencyStop('QA authorization expired'); return this._block(table, 'QA authorization expired'); }
      const scripted = decision && decision.source === 'scripted-fallback';
      // 0.35: the bundled CONTROLLED test table (never an external client) may also be driven by labelled scripted policies in QA mode,
      // so visible-input reliability can be measured when no solver decision exists; the adapter must declare controlledFixture.
      const fixtureOk = this.mode === 'qa' && options.allowScripted === true && adapter.controlledFixture === true;
      if (scripted && !(options.allowScripted === true && (this.mode === 'simulation' || fixtureOk) && typeof decision.label === 'string' && /SCRIPTED/.test(decision.label))) return this._block(table, 'Scripted fallback decisions run only in Simulation Mode (or on the bundled controlled test table), when explicitly allowed, and carry a SCRIPTED label', 'rejected');
      if (!decision || decision.status !== 'ok' || (decision.source !== 'eightmax-study' && !scripted)) return this._block(table, 'Only available EightMax study decisions are executed (no fallback policy)', 'rejected');
      const tStart = this.o.hrnow ? this.o.hrnow() : Date.now();
      const cur = this.o.stateOf(table);
      if (!cur || !cur.state || cur.paused) return this._block(table, 'Table state not reconstructed or paused: ' + (cur && cur.pauseReason || 'unknown'));
      const s = cur.state;
      if (cur.revision !== decision.revision || s.key !== decision.stateKey) return this._block(table, 'Stale decision: bound to revision ' + decision.revision + ', table is at ' + cur.revision, 'rejected');
      const age = this.o.now() - decision.issuedAt;
      if (!(age >= 0) || age > this.o.maxActionAgeMs) return this._block(table, 'Decision too old (' + age + ' ms > ' + this.o.maxActionAgeMs + ')', 'rejected');
      if (s.status !== 'playing' || s.actor !== decision.actor && decision.actor !== undefined) return this._block(table, 'No decision pending for this actor', 'rejected');
      let slot = decision.recommendedSlot;
      if (options.select === 'sample') { let u = this.o.random() * decision.probabilities.reduce((a, b) => a + b, 0); slot = decision.probabilities.length - 1; for (let i = 0; i < decision.probabilities.length; i++) { u -= decision.probabilities[i]; if (u < 0) { slot = i; break; } } }
      const abstract = decision.executable && decision.executable[slot];
      if (!abstract || !ACTIONS.includes(abstract.type)) return this._block(table, 'Decision has no executable action', 'rejected');
      const concrete = concretize(abstract, s);
      if (concrete.error) return this._block(table, 'Illegal in current state: ' + concrete.error, 'rejected');
      const key = [table, s.hand, decision.revision, concrete.type, concrete.amount].join(':');
      const slotKey = [table, s.hand, decision.revision].join(':');
      if (this.sent.has(slotKey) || this.inflight.has(slotKey)) return this._block(table, 'Duplicate action for this state', 'duplicate');
      this.inflight.add(slotKey);
      const me = s.seats && s.seats[s.actor], l = s.legal || {};
      const act = { key, table, hand: s.hand, actor: s.actor, simRevision: s.simRevision === null ? undefined : s.simRevision, type: concrete.type, amount: concrete.amount, abstractType: abstract.type,
        // 0.35: what a UI adapter needs to place the wager exactly (amount conventions, limits) - all from the reconstructed state
        context: { currentBet: s.currentBet, toCall: l.toCall, callAmount: l.callAmount, minRaiseTo: l.minRaiseTo, maxRaiseTo: l.maxRaiseTo, canRaise: l.canRaise, myBet: me ? me.bet : undefined, myStack: me ? me.stack : undefined, street: s.street } };
      let result = null, tries = 0;
      try {
        const maxRetries = adapter.noRetry === true ? 0 : this.o.maxRetries;   // 0.35: visible input is never re-sent blindly
        while (tries <= maxRetries) {
          tries++;
          if (this.estop) { this._log('aborted', table, 'Emergency stop during execution'); return { status: 'aborted', table }; }
          const ackMs = adapter.ackTimeoutMs || this.o.ackTimeoutMs;
          let timer; const r = await Promise.race([Promise.resolve(adapter.submit(act)), new Promise((res) => { timer = setTimeout(() => res({ timedOut: true }), ackMs); })]); clearTimeout(timer);
          if (r && r.timedOut) { this._log('ack-timeout', table, 'try ' + tries, { key }); continue; }
          result = r; break;
        }
      } catch (e) { result = { accepted: false, reason: 'Adapter error: ' + e.message, error: true }; }
      finally { this.inflight.delete(slotKey); }
      if (!result) {
        // The action may or may not have been applied; do nothing more on this table until an operator looks.
        this.sent.add(slotKey); this.counts.unconfirmed++;
        this.pauseTable(table, 'Unconfirmed action ' + concrete.type + '; manual review required');
        return { status: 'unconfirmed', table, key, tries };
      }
      // 0.35: an adapter that PROVES nothing reached the target (refused before any input) leaves the slot open for a later
      // attempt from a fresh observation; everything else - including timeouts and errors - counts as sent and is never repeated.
      if (result.accepted === false && result.noInputSent === true) { this.counts.rejected++; this._log('refused-before-input', table, result.reason, { key, code: result.code }); return { status: 'rejected', reason: result.reason, code: result.code, table, key, noInputSent: true }; }
      this.sent.add(slotKey);
      const submitMs = (this.o.hrnow ? this.o.hrnow() : Date.now()) - tStart; this.latencies.push(submitMs); if (this.latencies.length > 2000) this.latencies.shift();
      if (this.sent.size > 20000) this.sent = new Set([...this.sent].slice(-10000));
      if (!result.accepted) { this._log('refused', table, result.reason, { key }); this.counts.rejected++; if (result.inputMayHaveHappened) this.pauseTable(table, 'Input may have reached the table: ' + result.reason); return { status: 'rejected', reason: result.reason, code: result.code, table, key, inputMayHaveHappened: !!result.inputMayHaveHappened }; }
      // Optional independent acknowledgement of the NEW state (e.g. the next screen reading): without it the action is only "accepted by the interface".
      if (typeof options.verify === 'function') {
        let v; try { v = await options.verify({ table, hand: s.hand, key, action: concrete, result }); } catch (e) { v = { confirmed: false, reason: 'Verification threw: ' + e.message }; }
        if (v && v.confirmed !== true && v.status === 'rejected' && v.clean === true) { this.counts.rejected++; this._log('ack-rejected', table, v.reason || 'interface ignored the action', { key }); this.pauseTable(table, 'Action visibly rejected by the simulator: ' + (v.reason || '')); return { status: 'rejected', reason: v.reason, table, key, tries, verification: v }; }
        if (!v || v.confirmed !== true) { this.counts.unconfirmed++; this._log('ack-failed', table, (v && v.reason) || 'new state did not confirm the action', { key }); this.pauseTable(table, 'Action not confirmed by the next state: ' + ((v && v.reason) || 'unknown')); return { status: 'unconfirmed', table, key, tries, reason: v && v.reason }; }
      }
      if (scripted) this.counts.scripted++; else this.counts.executed++;
      this._log('executed', table, concrete.type + (concrete.amount ? ' ' + concrete.amount : ''), { key, tries, source: decision.source, probabilities: decision.probabilities, labels: decision.labels, submitMs, studyId: decision.studyId, path: decision.path });
      return { status: 'confirmed', table, key, action: concrete, abstractType: abstract.type, tries, simRevisionAfter: result.simRevisionAfter, submitMs, source: decision.source, via: result.via, input: result.input };
    }
    exportLog() { return { format: 'eightmax-executor-log', version: 1, mode: this.mode, counts: { ...this.counts }, entries: this.log.slice() }; }
    latencyStats() { const a = this.latencies.slice().sort((x, y) => x - y), q = (p) => a.length ? a[Math.min(a.length - 1, Math.ceil(p / 100 * a.length) - 1)] : null; return { n: a.length, p50: q(50), p95: q(95), max: a.length ? a[a.length - 1] : null }; }
  }

  /** Replay an exported log against a fresh simulator table sequence: verifies the recorded actions are legal and reproduce. */
  function replayLog(log, tableFactory) {
    if (!log || log.format !== 'eightmax-executor-log' || log.version !== 1) throw new Error('Unsupported executor log');
    const tables = new Map(); let applied = 0;
    for (const e of log.entries) {
      if (e.kind !== 'executed') continue;
      const [tid, , , type, amount] = e.key.split(':');
      let t = tables.get(+tid); if (!t) { t = tableFactory(+tid); tables.set(+tid, t); }
      if (t.status === 'ready' || t.status === 'complete') t.startHand();
      const req = t.request(type, +amount || 0, 0); t.execute(req, 0); applied++;
    }
    return { applied, tables: [...tables.values()] };
  }

  return { MODES, ACTIONS, validateAuthorization, SimulatorAdapter, ApprovedClientAdapter, concretize, TestExecutor, replayLog };
});
