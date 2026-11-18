/* EightMax Test Workbench 0.25: execution, acknowledgment and diagnostics ADAPTERS (platform independent).
 *
 * The executor (test-executor.js) decides WHETHER an action may be sent; an execution adapter decides HOW it reaches an
 * AUTHORISED test target. Three interchangeable kinds exist, chosen by `profile.execution.interface`:
 *   internal-simulation   the workbench's own simulator (always available)
 *   test-server-api       an HTTP test server named in a QA authorisation record (loopback or individually allow-listed host)
 *   approved-ui-automation a generic driver that clicks regions taken from the PROFILE (never hard-coded), for a test client the operator owns
 * Nothing here knows any external poker client. A UI driver must be supplied by the host and is exercised in this build only with a mock.
 * No anti-detection, no hidden input, no process-memory access.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./test-executor.js'));
  else root.WorkbenchExecutionAdapters = factory(root.WorkbenchExecutor);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (EX) {
  'use strict';

  const mono = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  /** Every execution adapter must look like this (checked before it can be attached). */
  const ADAPTER_CONTRACT = Object.freeze({ kind: ['simulator', 'approved-client'], submit: 'function(act) -> {accepted, reason?, simRevisionAfter?} | Promise', id: 'string' });
  function assertAdapter(a) {
    const problems = [];
    if (!a || typeof a !== 'object') return { ok: false, problems: ['adapter missing'] };
    if (!ADAPTER_CONTRACT.kind.includes(a.kind)) problems.push('adapter.kind must be one of ' + ADAPTER_CONTRACT.kind.join(', '));
    if (typeof a.submit !== 'function') problems.push('adapter.submit must be a function'); if (typeof a.id !== 'string' || !a.id) problems.push('adapter.id must be a non-empty string');
    return { ok: problems.length === 0, problems };
  }

  /**
   * Generic UI-automation adapter. `driver.activate(regionName, box)` performs ONE click on a normalised region of the target window and
   * `driver.enterAmount(text)` types a wager. Regions come from `controls` (profile.layout.controls) — nothing is assumed about any client.
   * It refuses to be built without a valid QA authorisation and a driver, and it never submits an amount it cannot type exactly.
   */
  class UiAutomationAdapter {
    constructor({ authorization, now, driver, controls, amountField }) {
      const v = EX.validateAuthorization(authorization, typeof now === 'function' ? now() : Date.now()); if (!v.valid) throw new Error('QA authorization refused: ' + v.issues.join('; '));
      if (!driver || typeof driver.activate !== 'function') throw new Error('A UI driver with activate(region, box) is required');
      if (!controls || !['fold', 'check', 'call', 'raise'].every((k) => controls[k])) throw new Error('Profile control regions fold/check/call/raise are required');
      this.kind = 'approved-client'; this.transportKind = 'ui-automation'; this.id = 'ui:' + authorization.environment; this.auth = authorization; this.driver = driver; this.controls = controls; this.amountField = amountField || null; this.sentKeys = new Set();
    }
    async submit(act) {
      if (this.sentKeys.has(act.key)) return { accepted: false, reason: 'Duplicate idempotency key' };
      const region = act.type === 'fold' ? 'fold' : act.type === 'check' ? 'check' : act.type === 'call' ? 'call' : 'raise';
      if (region === 'raise') {
        if (!this.amountField || typeof this.driver.enterAmount !== 'function') return { accepted: false, reason: 'Profile has no wager-entry field; cannot place a bet/raise exactly' };
        if (!Number.isInteger(act.amount) || act.amount <= 0) return { accepted: false, reason: 'Wager amount invalid' };
        const typed = await this.driver.enterAmount(String(act.amount), this.amountField); if (!typed || typed.ok !== true) return { accepted: false, reason: 'Could not enter the wager: ' + (typed && typed.reason || 'driver refused') };
      }
      const r = await this.driver.activate(region, this.controls[region]); this.sentKeys.add(act.key);
      return r && r.ok === true ? { accepted: true, via: 'ui-automation', region } : { accepted: false, reason: 'Click failed: ' + (r && r.reason || 'driver refused') };
    }
  }

  /** Build the adapter a profile asks for. Throws (never silently downgrades) when the required authorisation, transport or driver is missing. */
  function adapterForProfile(profile, deps = {}) {
    const e = profile && profile.execution; if (!e) throw new Error('Profile has no execution section');
    switch (e.interface) {
      case 'none': return null;
      case 'internal-simulation': if (!deps.table) throw new Error('internal-simulation needs the simulator table'); return new EX.SimulatorAdapter(deps.table, deps.clock);
      case 'test-server-api': return new EX.ApprovedClientAdapter(deps.authorization, deps.now ? deps.now() : Date.now(), deps.transport);
      case 'approved-ui-automation': return new UiAutomationAdapter({ authorization: deps.authorization, now: deps.now, driver: deps.driver, controls: profile.layout && profile.layout.controls, amountField: e.amountField });
      default: throw new Error('Unknown execution interface ' + e.interface);
    }
  }

  /**
   * Acknowledgment adapter (pure): did the NEXT reconstructed state show exactly the action that was sent?
   *   confirmed  - exactly one new action in the same hand, matching seat/type/amount, or the hand ended with it as the last action
   *   rejected   - no new action and the same actor is still to act (the interface ignored it)
   *   ambiguous  - anything else (extra or different actions, hand moved on without a record); the table must be suspended, never retried blindly
   */
  function confirmAction(sent, before, after) {
    if (!before || !after) return { status: 'ambiguous', reason: 'missing state' };
    if (after.hand !== before.hand) return { status: 'ambiguous', reason: 'hand changed (' + before.hand + ' -> ' + after.hand + ') with no record of the action' };
    const n0 = before.actions.length, n1 = after.actions.length;
    if (n1 === n0) return after.actor === before.actor && after.status !== 'complete' ? { status: 'rejected', reason: 'no new action observed; same actor still to act' } : { status: 'ambiguous', reason: 'no new action but the table moved' };
    if (n1 !== n0 + 1 && !(after.status === 'complete' && n1 > n0)) return { status: 'ambiguous', reason: (n1 - n0) + ' new actions observed after one submission' };
    const h = after.actions[n0], wager = ['bet', 'raise', 'allin'];
    const same = h.seat === sent.seat && (wager.includes(sent.type) ? wager.includes(h.type) && h.amount === sent.amount : h.type === sent.type);
    return same ? { status: 'confirmed', observed: h } : { status: 'ambiguous', reason: 'observed ' + h.type + ' by seat ' + h.seat + ' differs from the submitted ' + sent.type + ' by seat ' + sent.seat, observed: h };
  }

  /** Diagnostics adapter: one bounded, ordered record of capture / recognition / state / decision / action events per table, exportable for replay review. */
  class DiagnosticsRecorder {
    constructor(o = {}) { this.max = o.max || 5000; this.clock = o.clock || mono; this.events = []; this.counts = {}; this.seq = 0; this.dropped = 0; }
    record(table, stage, detail = {}) {
      if (!['capture', 'recognition', 'state', 'decision', 'validation', 'execution', 'ack', 'resource', 'system'].includes(stage)) throw new Error('Unknown diagnostics stage ' + stage);
      const e = { seq: ++this.seq, t: this.clock(), table, stage, ...detail }; this.events.push(e); this.counts[stage] = (this.counts[stage] || 0) + 1;
      if (this.events.length > this.max) { this.events.shift(); this.dropped++; } return e;
    }
    forTable(table) { return this.events.filter((e) => e.table === table); }
    errors() { return this.events.filter((e) => e.ok === false || e.error); }
    export() { return { format: 'eightmax-diagnostics', version: 1, counts: { ...this.counts }, dropped: this.dropped, events: this.events.slice() }; }
  }

  return { ADAPTER_CONTRACT, assertAdapter, UiAutomationAdapter, adapterForProfile, confirmAction, DiagnosticsRecorder };
});
