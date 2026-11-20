/* EightMax Test Workbench 0.25 (0.35: real Windows input driver behind the UI adapter): execution, acknowledgment and diagnostics ADAPTERS (platform independent).
 *
 * The executor (test-executor.js) decides WHETHER an action may be sent; an execution adapter decides HOW it reaches an
 * AUTHORISED test target. Three interchangeable kinds exist, chosen by `profile.execution.interface`:
 *   internal-simulation   the workbench's own simulator (always available)
 *   test-server-api       an HTTP test server named in a QA authorisation record (loopback or individually allow-listed host)
 *   approved-ui-automation a generic driver that clicks regions taken from the PROFILE (never hard-coded), for a test client the operator owns
 * Nothing here knows any external poker client. 0.35: the UI driver is src/windows-input-driver.js (WindowsUiDriver -> desktop/bin/EightMaxInput.exe).
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

  /** 0.35: driver refusals that happen BEFORE any button is pressed (nothing reached the simulator). Anything else may have clicked. */
  const BEFORE_INPUT = new Set(['layout-changed', 'outside-region', 'outside-window', 'target-covered', 'window-minimized', 'window-hidden', 'window-gone', 'identity-changed', 'target-not-registered', 'authorization-expired', 'not-armed', 'focus-denied', 'focus-lost', 'move-too-long', 'deadline', 'bad-request', 'bad-motion', 'unexpected-control', 'queue-full', 'expired', 'field-not-focused', 'field-unreadable', 'field-unexpected', 'clear-failed', 'verify-mismatch', 'manual-mode', 'wager-invalid', 'paused', 'stale', 'table-busy', 'no-deadline', 'double-click-not-authorized']);
  /** 0.35: wager conventions a simulator's entry field can use. raise-to = the total the player's bet becomes; raise-by = chips ABOVE the current highest bet. */
  const AMOUNT_CONVENTIONS = Object.freeze(['raise-to', 'raise-by']);
  /**
   * Validate and convert an executor wager (always RAISE-TO, from concretize) into the text to type. Never rounds: an amount that is
   * not a whole number of chip units, or outside the legal range, or beyond the stack, is refused.
   */
  function wagerText(act, o = {}) {
    const c = act.context || {}, unit = o.chipUnit || 1, conv = o.amountConvention || 'raise-to', to = act.amount;
    if (!AMOUNT_CONVENTIONS.includes(conv)) return { ok: false, reason: 'Unknown amount convention ' + conv };
    if (!Number.isInteger(to) || to <= 0) return { ok: false, reason: 'Wager amount invalid' };
    if (to % unit !== 0) return { ok: false, reason: 'Wager ' + to + ' is not a whole number of chip units (' + unit + ')' };
    if (Number.isFinite(c.currentBet) && to <= c.currentBet) return { ok: false, reason: 'Raise-to ' + to + ' does not exceed the current bet ' + c.currentBet };
    if (Number.isFinite(c.maxRaiseTo) && to > c.maxRaiseTo) return { ok: false, reason: 'Wager ' + to + ' exceeds the maximum ' + c.maxRaiseTo + ' (stack)' };
    if (Number.isFinite(c.minRaiseTo) && to < c.minRaiseTo && to !== c.maxRaiseTo) return { ok: false, reason: 'Wager ' + to + ' is below the minimum ' + c.minRaiseTo };
    if (Number.isFinite(c.myStack) && Number.isFinite(c.myBet) && to > c.myStack + c.myBet) return { ok: false, reason: 'Wager exceeds the available stack' };
    if (c.canRaise === false) return { ok: false, reason: 'Raising is not available' };
    if (conv === 'raise-by') { if (!Number.isFinite(c.currentBet)) return { ok: false, reason: 'raise-by needs the current bet, which was not read' }; return { ok: true, text: String(to - c.currentBet), to, convention: conv }; }
    return { ok: true, text: String(to), to, convention: conv };
  }

  /**
   * Generic UI-automation adapter. `driver.activate(regionName, box, act)` performs ONE click on a normalised region of the target window and
   * `driver.enterAmount(text, field, act)` types a wager and reads it back. Regions come from `controls` (profile.layout.controls) — nothing is
   * assumed about any client. It refuses to be built without a valid QA authorisation and a driver, and it never submits an amount it cannot
   * type exactly. 0.35: the idempotency key is recorded BEFORE any input (a slow click can no longer be repeated by an executor retry),
   * visible input is never retried (noRetry), an "allin" control is used when the profile has one, wagers follow the profile's amount
   * convention, and with a scheduler every submission runs inside one exclusive cursor lease with a deadline.
   */
  class UiAutomationAdapter {
    constructor({ authorization, now, driver, controls, amountField, amountConvention, chipUnit, scheduler, deadlineMs, controlledFixture, table }) {
      const v = EX.validateAuthorization(authorization, typeof now === 'function' ? now() : Date.now()); if (!v.valid) throw new Error('QA authorization refused: ' + v.issues.join('; '));
      if (!driver || typeof driver.activate !== 'function') throw new Error('A UI driver with activate(region, box) is required');
      if (!controls || !['fold', 'check', 'call', 'raise'].every((k) => controls[k])) throw new Error('Profile control regions fold/check/call/raise are required');
      this.kind = 'approved-client'; this.transportKind = 'ui-automation'; this.id = 'ui:' + authorization.environment; this.auth = authorization; this.driver = driver; this.controls = controls; this.amountField = amountField || null; this.sentKeys = new Set();
      this.amountConvention = amountConvention || 'raise-to'; this.chipUnit = chipUnit || 1; this.scheduler = scheduler || null; this.deadlineMs = deadlineMs || 8000; this.controlledFixture = controlledFixture === true; this.table = table; this.noRetry = true; this.ackTimeoutMs = 60000;
      if (!AMOUNT_CONVENTIONS.includes(this.amountConvention)) throw new Error('Unknown amount convention ' + this.amountConvention);
    }
    async submit(act) {
      if (this.sentKeys.has(act.key)) return { accepted: false, reason: 'Duplicate idempotency key', code: 'duplicate' };
      const allIn = this.controls.allin && (act.type === 'allin' || (act.abstractType === 'allin' && act.type === 'raise' && act.context && act.amount === act.context.maxRaiseTo));
      const region = allIn ? 'allin' : act.type === 'fold' ? 'fold' : act.type === 'check' ? 'check' : act.type === 'call' ? 'call' : 'raise';
      let wager = null;
      if (region === 'raise') {
        if (!this.amountField || typeof this.driver.enterAmount !== 'function') return { accepted: false, reason: 'Profile has no wager-entry field; cannot place a bet/raise exactly' };
        wager = wagerText(act, { amountConvention: this.amountConvention, chipUnit: this.chipUnit }); if (!wager.ok) return { accepted: false, reason: wager.reason, code: 'wager-invalid', noInputSent: true };
      }
      this.sentKeys.add(act.key);   // before any input: one key, at most one attempt
      if (this.sentKeys.size > 20000) this.sentKeys = new Set([...this.sentKeys].slice(-10000));
      const perform = async (lease) => {
        if (wager) {
          const typed = await this.driver.enterAmount(wager.text, this.amountField, act);
          // No action button was pressed yet: a failed or unverifiable wager entry sends no action (the driver cleared the field).
          if (!typed || typed.ok !== true) return { accepted: false, reason: 'Could not enter the wager: ' + (typed && typed.reason || 'driver refused'), code: typed && typed.code, inputMayHaveHappened: false, noInputSent: BEFORE_INPUT.has(typed && typed.code) || !(typed && typed.code) };
          if (lease && lease.remainingMs && lease.remainingMs() < 0) return { accepted: false, reason: 'Deadline passed while typing; not submitted', code: 'deadline', noInputSent: true };
        }
        const r = await this.driver.activate(region, this.controls[region], act);
        if (r && r.ok === true) return r.detail ? { accepted: true, via: 'ui-automation', region, input: { region, wager: wager && wager.text, convention: wager && wager.convention, ...r.detail } } : { accepted: true, via: 'ui-automation', region };
        // A refusal before the button press is clean; an error after pressing could mean the click happened.
        const before = !!(r && BEFORE_INPUT.has(r.code));
        return { accepted: false, reason: 'Click failed: ' + (r && r.reason || 'driver refused'), code: r && r.code, inputMayHaveHappened: !before, noInputSent: before };
      };
      const finish = (res) => { if (res && res.accepted === false && res.noInputSent === true) this.sentKeys.delete(act.key); return res; };
      if (!this.scheduler) return finish(await perform(null));
      const est = (typeof this.driver.estimateMs === 'function' ? this.driver.estimateFor(region, this.controls[region], wager) : 0) || 0;
      const out = await this.scheduler.submit({ table: act.table, kind: region, deadline: (act.deadline || (this.scheduler.now() + this.deadlineMs)), estimateMs: est, revalidate: act.revalidate, run: perform });
      if (!out.ok) return finish({ accepted: false, reason: 'Input scheduler: ' + out.reason, code: out.code, inputMayHaveHappened: out.code === 'run-failed', noInputSent: out.code !== 'run-failed' });
      return finish(out.result);
    }
  }

  /** Build the adapter a profile asks for. Throws (never silently downgrades) when the required authorisation, transport or driver is missing. */
  function adapterForProfile(profile, deps = {}) {
    const e = profile && profile.execution; if (!e) throw new Error('Profile has no execution section');
    switch (e.interface) {
      case 'none': return null;
      case 'internal-simulation': if (!deps.table) throw new Error('internal-simulation needs the simulator table'); return new EX.SimulatorAdapter(deps.table, deps.clock);
      case 'test-server-api': return new EX.ApprovedClientAdapter(deps.authorization, deps.now ? deps.now() : Date.now(), deps.transport);
      case 'approved-ui-automation': return new UiAutomationAdapter({ authorization: deps.authorization, now: deps.now, driver: deps.driver, controls: { ...(profile.layout && profile.layout.controls), ...(e.controls || {}) }, amountField: e.amountField, amountConvention: e.amountConvention, chipUnit: e.chipUnit, scheduler: deps.scheduler, deadlineMs: deps.deadlineMs, controlledFixture: profile.verification && profile.verification.status === 'controlled-renderer' && e.controlledFixture === true, table: deps.tableId });
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

  return { ADAPTER_CONTRACT, AMOUNT_CONVENTIONS, BEFORE_INPUT, assertAdapter, wagerText, UiAutomationAdapter, adapterForProfile, confirmAction, DiagnosticsRecorder };
});
