'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const XA = require('../src/execution-adapters.js'), EX = require('../src/test-executor.js'), PP = require('../src/platform-profile.js'), EM = require('../src/engine.js');
const auth = (o = {}) => ({ format: 'eightmax-qa-authorization', version: 1, environment: 'own-test-client', approvedBy: 'Test Owner', testEnvironmentOnly: true, noRealMoney: true, operatorOwnsTestClient: true, expiresAt: Date.now() + 3600e3, endpoint: 'http://127.0.0.1:9000/act', ...o });
const driver = () => { const calls = []; return { calls, activate: async (r, b) => { calls.push(['click', r, b]); return { ok: true }; }, enterAmount: async (t) => { calls.push(['type', t]); return { ok: true }; } }; };
const ctl = PP.controlledProfile(2).layout.controls;

test('adapter contract rejects unknown kinds and missing methods', () => {
  assert.equal(XA.assertAdapter(new EX.SimulatorAdapter(new EM.Table(1, 1))).ok, true);
  const r = XA.assertAdapter({ kind: 'magic' }); assert.equal(r.ok, false); assert.equal(r.problems.length, 3); assert.equal(XA.assertAdapter(null).ok, false);
});
test('profile interface selects the adapter; "none" means no execution; missing authorisation refuses instead of downgrading', () => {
  const p = PP.controlledProfile(2); assert.equal(XA.adapterForProfile(p, { table: new EM.Table(1, 1) }).kind, 'simulator');
  assert.throws(() => XA.adapterForProfile(p, {}), /needs the simulator/);
  assert.equal(XA.adapterForProfile({ ...p, execution: { interface: 'none', requiresAuthorization: true } }), null);
  const srv = { ...p, execution: { interface: 'test-server-api', requiresAuthorization: true } };
  assert.throws(() => XA.adapterForProfile(srv, {}), /QA authorization refused/);
  assert.throws(() => XA.adapterForProfile(srv, { authorization: auth({ endpoint: 'http://some-remote-host.example/act' }), transport: async () => ({}) }), /not loopback/);
  assert.equal(XA.adapterForProfile(srv, { authorization: auth(), transport: async () => ({ accepted: true }) }).kind, 'approved-client');
  assert.throws(() => XA.adapterForProfile({ ...p, execution: { interface: 'x' } }, {}), /Unknown execution interface/);
});
test('UI-automation adapter needs authorisation, a driver and profile regions; it clicks only profile regions', async () => {
  assert.throws(() => new XA.UiAutomationAdapter({ authorization: auth({ noRealMoney: false }), driver: driver(), controls: ctl }), /refused/);
  assert.throws(() => new XA.UiAutomationAdapter({ authorization: auth(), driver: null, controls: ctl }), /driver/);
  assert.throws(() => new XA.UiAutomationAdapter({ authorization: auth(), driver: driver(), controls: { fold: ctl.fold } }), /control regions/);
  const d = driver(), a = new XA.UiAutomationAdapter({ authorization: auth(), driver: d, controls: ctl, amountField: { x: 0.5, y: 0.9, w: 0.1, h: 0.05 } });
  assert.deepEqual(await a.submit({ key: 'k1', type: 'call', amount: 200 }), { accepted: true, via: 'ui-automation', region: 'call' }); assert.deepEqual(d.calls[0], ['click', 'call', ctl.call]);
  assert.equal((await a.submit({ key: 'k2', type: 'raise', amount: 450 })).accepted, true); assert.deepEqual(d.calls.slice(1), [['type', '450'], ['click', 'raise', ctl.raise]]);
  assert.equal((await a.submit({ key: 'k1', type: 'call' })).accepted, false, 'duplicate key refused');
  assert.equal((await a.submit({ key: 'k3', type: 'raise', amount: 0 })).accepted, false);
  const noField = new XA.UiAutomationAdapter({ authorization: auth(), driver: driver(), controls: ctl }); assert.match((await noField.submit({ key: 'z', type: 'raise', amount: 300 })).reason, /no wager-entry field/);
  const failing = new XA.UiAutomationAdapter({ authorization: auth(), driver: { activate: async () => ({ ok: false, reason: 'window gone' }) }, controls: ctl }); assert.match((await failing.submit({ key: 'q', type: 'fold' })).reason, /window gone/);
});
test('UI-automation adapter attaches in QA mode, never in simulation or study', async () => {
  const ex = new EX.TestExecutor({ stateOf: () => null }); const a = new XA.UiAutomationAdapter({ authorization: auth(), driver: driver(), controls: ctl });
  ex.setMode('simulation'); assert.throws(() => ex.attach(1, a), /Simulation mode accepts only simulator/);
  ex.setMode('qa', { authorization: auth() }); ex.attach(1, a); assert.equal(ex.adapters.get(1), a);
  ex.emergencyStop('test'); const r = await ex.execute({ table: 1, status: 'ok' }); assert.equal(r.status, 'blocked');
});
test('acknowledgment: confirmed, rejected (ignored) and ambiguous outcomes', () => {
  const sent = { seat: 3, type: 'raise', amount: 450 }, A = (n, extra = {}) => ({ hand: 7, status: 'playing', actor: 3, actions: Array.from({ length: n }, (_, i) => ({ seat: i % 8, type: 'call', amount: 0 })), ...extra });
  const before = A(4), ok = { ...A(5, { actor: 4 }) }; ok.actions[4] = { seat: 3, type: 'raise', amount: 450 };
  assert.equal(XA.confirmAction(sent, before, ok).status, 'confirmed');
  assert.equal(XA.confirmAction(sent, before, A(4)).status, 'rejected');
  assert.equal(XA.confirmAction(sent, before, A(4, { actor: 5 })).status, 'ambiguous');
  assert.equal(XA.confirmAction(sent, before, A(6, { actor: 5 })).status, 'ambiguous');
  const wrong = A(5, { actor: 4 }); wrong.actions[4] = { seat: 3, type: 'raise', amount: 500 }; assert.equal(XA.confirmAction(sent, before, wrong).status, 'ambiguous');
  assert.equal(XA.confirmAction(sent, before, A(5, { hand: 8 })).status, 'ambiguous'); assert.equal(XA.confirmAction(sent, null, null).status, 'ambiguous');
  const over = A(5, { actor: -1, status: 'complete' }); over.actions[4] = { seat: 3, type: 'allin', amount: 450 }; assert.equal(XA.confirmAction(sent, before, over).status, 'confirmed', 'a wager recorded as all-in is the same action');
});
test('diagnostics recorder is bounded, ordered, per-table and exportable', () => {
  let t = 0; const d = new XA.DiagnosticsRecorder({ max: 5, clock: () => ++t });
  for (let i = 0; i < 8; i++) d.record(i % 2 + 1, i % 3 ? 'capture' : 'recognition', i === 4 ? { ok: false, reason: 'blank' } : {});
  assert.equal(d.events.length, 5); assert.equal(d.dropped, 3); assert.ok(d.events.every((e, i, a) => !i || e.seq > a[i - 1].seq)); assert.equal(d.forTable(1).every((e) => e.table === 1), true); assert.equal(d.errors().length, 1);
  assert.throws(() => d.record(1, 'bogus'), /Unknown diagnostics stage/); assert.equal(d.export().format, 'eightmax-diagnostics');
});
