'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const EM = require('../src/engine.js'), EX = require('../src/test-executor.js');
const { screen, engine } = require('./screen-util.cjs');

function rig(mode = 'simulation', opts = {}) {
  const t = new EM.Table(1, opts.seed || 3), e = engine(); t.startHand(); const r = e.ingest(screen(t, 0)); let now = 1000;
  const x = new EX.TestExecutor({ stateOf: () => ({ state: e.state, paused: e.paused, pauseReason: e.pauseReason, revision: e.revision }), now: () => now, maxActionAgeMs: 1500 });
  x.setMode(mode); x.attach(1, new EX.SimulatorAdapter(t, () => 0));
  const decision = (action, extra = {}) => ({ status: 'ok', source: 'eightmax-study', table: 1, hand: t.hand, revision: e.revision, stateKey: e.state.key, actor: e.state.actor, issuedAt: now, labels: [action.type], probabilities: [1], recommendedSlot: 0, executable: [action], studyId: 'unit', ...extra });
  return { t, e, x, r, decision, tick: (ms) => { now += ms; } };
}

test('bet versus raise: an opening postflop wager is a bet, a wager facing one is a raise; tree labels cannot be misused', () => {
  const pre = engine(); const t = new EM.Table(1, 3); t.startHand(); pre.ingest(screen(t, 0));
  assert.deepEqual(EX.concretize({ type: 'raise', amount: 300 }, pre.state), { type: 'raise', amount: 300 });
  assert.equal(EX.concretize({ type: 'bet', amount: 300 }, pre.state).error, 'bet-facing-a-wager (use raise)');
  assert.equal(EX.concretize({ type: 'raise', amount: 150 }, pre.state).error, 'raise-size-illegal'); assert.equal(EX.concretize({ type: 'raise', amount: 100 }, pre.state).error, 'raise-size-illegal'); assert.equal(EX.concretize({ type: 'allin' }, pre.state).amount, pre.state.legal.maxRaiseTo);
  const flop = new EM.Table(1, 5), e = engine(); flop.startHand(); let q = 0; e.ingest(screen(flop, q++)); for (let i = 0; i < 8; i++) { flop.execute(flop.request(flop.legal().toCall > 0 ? 'call' : 'check', 0, 0), 0); e.ingest(screen(flop, q++)); }
  assert.equal(e.state.street, 'flop'); assert.equal(EX.concretize({ type: 'bet', amount: 198 }, e.state).type, 'raise'); assert.equal(EX.concretize({ type: 'raise', amount: 198 }, e.state).error, 'raise-with-no-wager (use bet)');
  assert.equal(EX.concretize({ type: 'check' }, e.state).type, 'check'); assert.equal(EX.concretize({ type: 'call' }, e.state).error, 'nothing-to-call'); assert.equal(EX.concretize({ type: 'fold' }, e.state).type, 'fold');
});
test('every pre-execution check blocks: table, hand, actor, revision, legality, size, freshness, mode, pause, authorization', async () => {
  const R = rig(); const d = R.decision({ type: 'call' });
  assert.equal((await R.x.execute({ ...d, table: 2 })).status, 'blocked'); assert.match((await R.x.execute({ ...d, table: 2 })).reason, /No adapter/);
  assert.equal((await R.x.execute({ ...d, revision: d.revision + 1 })).status, 'rejected'); assert.match((await R.x.execute({ ...d, revision: d.revision + 1 })).reason, /Stale/);
  assert.equal((await R.x.execute({ ...d, stateKey: 'other' })).status, 'rejected');
  assert.equal((await R.x.execute({ ...d, actor: (d.actor + 1) % 8 })).status, 'rejected');
  R.tick(5000); const old = await R.x.execute(d); assert.equal(old.status, 'rejected'); assert.match(old.reason, /too old/); R.tick(-5000);
  const big = await R.x.execute(R.decision({ type: 'raise', amount: 99999 })); assert.equal(big.status, 'rejected'); assert.match(big.reason, /raise-size-illegal/);
  const none = await R.x.execute({ ...d, executable: [] }); assert.equal(none.status, 'rejected');
  R.x.pauseTable(1, 'operator'); assert.equal((await R.x.execute(d)).status, 'blocked'); R.x.resumeTable(1);
  R.x.setMode('study'); assert.match((await R.x.execute(d)).reason, /Study mode never executes/); R.x.setMode('simulation');
  assert.equal(R.t.actions, 0, 'nothing reached the table while every check failed'); const ok = await R.x.execute(d); assert.equal(ok.status, 'confirmed'); assert.equal(R.t.actions, 1);
});
test('duplicate submissions are blocked, including concurrent ones; the table sees exactly one action', async () => {
  const R = rig(); const d = R.decision({ type: 'call' }); const [a, b] = await Promise.all([R.x.execute(d), R.x.execute(d)]);
  assert.deepEqual([a.status, b.status].sort(), ['confirmed', 'duplicate']); assert.equal(R.t.actions, 1); assert.equal((await R.x.execute(d)).status, 'duplicate', 'a later retry of the same decision is still never re-sent');
});
test('scripted fallback decisions: simulation only, explicitly allowed, labelled, counted apart; never in QA mode', async () => {
  const R = rig(); const s = { ...R.decision({ type: 'call' }), source: 'scripted-fallback', label: 'SCRIPTED FALLBACK — not a solver decision' };
  assert.equal((await R.x.execute(s)).status, 'rejected'); assert.equal((await R.x.execute({ ...s, label: 'just a decision' }, { allowScripted: true })).status, 'rejected'); const ok = await R.x.execute(s, { allowScripted: true });
  assert.equal(ok.status, 'confirmed'); assert.equal(R.x.counts.scripted, 1); assert.equal(R.x.counts.executed, 0); assert.equal(ok.source, 'scripted-fallback');
  const A = { format: 'eightmax-qa-authorization', version: 1, environment: 'unit-test-env', approvedBy: 'test operator', testEnvironmentOnly: true, noRealMoney: true, operatorOwnsTestClient: true, expiresAt: Date.now() + 1e6, endpoint: 'http://127.0.0.1:1/v1' };
  const x2 = new EX.TestExecutor({ stateOf: () => null }); x2.setMode('qa', { authorization: A }); assert.equal((await x2.execute(s, { allowScripted: true })).status, 'blocked', 'no adapter');
});
test('acknowledgement: an action the next state does not confirm leaves the table paused and unconfirmed', async () => {
  const R = rig(); const d = R.decision({ type: 'call' }); const res = await R.x.execute(d, { verify: async () => ({ confirmed: false, reason: 'next reading shows nothing changed' }) });
  assert.equal(res.status, 'unconfirmed'); assert.match(res.reason, /nothing changed/); assert.equal(R.x.pausedTables.has(1), true); assert.equal(R.x.counts.unconfirmed, 1); assert.equal(R.x.counts.executed, 0);
  assert.ok(R.x.log.some((l) => l.kind === 'ack-failed'));
  const R2 = rig(); const ok = await R2.x.execute(R2.decision({ type: 'call' }), { verify: async (v) => ({ confirmed: v.action.type === 'call' && v.table === 1 }) }); assert.equal(ok.status, 'confirmed');
  const R3 = rig(); const thrown = await R3.x.execute(R3.decision({ type: 'call' }), { verify: async () => { throw new Error('screen unreadable'); } }); assert.equal(thrown.status, 'unconfirmed');
});
test('adapter failures: refusal is recorded, timeout retries then pauses the table as unconfirmed, latency is recorded', async () => {
  const R = rig('simulation'); const d = R.decision({ type: 'call' }); const ok = await R.x.execute(d); assert.ok(ok.submitMs >= 0); const lat = R.x.latencyStats(); assert.equal(lat.n, 1);
  const R2 = rig(); R2.x.adapters.set(1, { kind: 'simulator', submit: () => new Promise(() => {}) }); R2.x.o.ackTimeoutMs = 20; R2.x.o.maxRetries = 1; const t = await R2.x.execute(R2.decision({ type: 'call' }));
  assert.equal(t.status, 'unconfirmed'); assert.equal(t.tries, 2); assert.equal(R2.x.pausedTables.has(1), true);
  const R3 = rig(); R3.x.adapters.set(1, { kind: 'simulator', submit: () => ({ accepted: false, reason: 'client said no' }) }); const rj = await R3.x.execute(R3.decision({ type: 'call' })); assert.equal(rj.status, 'rejected'); assert.equal(rj.reason, 'client said no');
  const R4 = rig(); R4.x.adapters.set(1, { kind: 'simulator', submit: () => { throw new Error('socket closed'); } }); const er = await R4.x.execute(R4.decision({ type: 'call' })); assert.equal(er.status, 'rejected'); assert.match(er.reason, /Adapter error/);
});
test('emergency stop aborts an in-flight submission and latches until reset', async () => {
  const R = rig(); let release; R.x.adapters.set(1, { kind: 'simulator', submit: () => new Promise((r) => { release = r; }) }); R.x.o.ackTimeoutMs = 30;
  const p = R.x.execute(R.decision({ type: 'call' })); await new Promise((r) => setTimeout(r, 5)); R.x.emergencyStop('operator'); const res = await p; assert.ok(['aborted', 'unconfirmed'].includes(res.status));
  assert.equal((await R.x.execute(R.decision({ type: 'call' }))).status, 'blocked'); assert.throws(() => R.x.setMode('study'), /Emergency stop latched/); R.x.reset(); R.x.setMode('study'); if (release) release({ accepted: true });
});
test('QA authorization: needed, time-limited, loopback unless individually allow-listed, every attestation required', () => {
  const now = Date.now(), base = { format: 'eightmax-qa-authorization', version: 1, environment: 'unit-test-env', approvedBy: 'test operator', testEnvironmentOnly: true, noRealMoney: true, operatorOwnsTestClient: true, expiresAt: now + 3600e3, endpoint: 'http://127.0.0.1:9/v1' };
  assert.equal(EX.validateAuthorization(base, now).valid, true);
  for (const [k, v, re] of [['testEnvironmentOnly', false, /testEnvironmentOnly/], ['noRealMoney', false, /noRealMoney/], ['operatorOwnsTestClient', undefined, /operatorOwnsTestClient/], ['expiresAt', now - 1, /expired/], ['expiresAt', now + 9 * 3600e3, /8 hours/], ['endpoint', 'http://poker.example.com/api', /not loopback/], ['endpoint', 'ftp://127.0.0.1/', /http/], ['approvedBy', '', /Approver/]]) assert.match(EX.validateAuthorization({ ...base, [k]: v }, now).issues.join(';'), re, k);
  assert.equal(EX.validateAuthorization({ ...base, endpoint: 'https://qa.internal.test/v1', allowedHosts: ['qa.internal.test'] }, now).valid, true); assert.equal(EX.validateAuthorization(null, now).valid, false);
  assert.throws(() => new EX.TestExecutor({ stateOf: () => null }).setMode('qa', {}), /QA mode refused/); assert.throws(() => new EX.ApprovedClientAdapter({ ...base, expiresAt: now - 5 }, now, () => {}), /refused/);
});
