'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const EM = require('../src/engine.js'), FH = require('../src/full-hand.js'), SS = require('../src/solver-service.js'), ST = require('../src/solver-tree.js'), A = require('../src/study-adapter.js'), IC = require('../src/image-codec.js');
const LM = require('../tests/load-solver.cjs'), { study } = require('./study-fixture.cjs');
const { startQaServer } = require('../tools/qa-test-server.cjs'), { QaHttpClient } = require('../src/qa-client.js');

const none = { decide: async () => ({ status: 'unavailable', reason: 'no solver in this test' }) };
function pipe(o = {}) {
  const table = o.table || new EM.Table(1, o.seed || 123), client = o.client || new FH.OfflineClient(table);
  return { table, client, p: new FH.SingleTablePipeline({ client, vision: FH.makeVision(1), decisionSource: none, allowScripted: true, scriptedWhen: () => true, seed: 5, ...o }) };
}
const total = (t) => t.players.reduce((a, p) => a + p.stack, 0);
const preflopAndPostflop = () => { const s = study(); return new ST.CompositeDecisionSource([s.src, new ST.PostflopStudySource({ EM: LM, adapter: A, iterations: 1200 })]); };

test('complete hands from pixels only: preflop to settlement, chips conserved, every action acknowledged (12 hands, scripted decisions isolate the vision/state/execution path)', async () => {
  const { p, table } = pipe(); const rep = await p.run(12);
  assert.equal(rep.completed, 12); assert.equal(rep.totals.suspended, 0); assert.equal(rep.totals.rejectedFrames, 0); assert.equal(rep.totals.ackMismatches, 0); assert.equal(total(table), 20000); table.validate();
  for (const h of p.hands) { assert.equal(h.settlementOk, true); assert.equal(h.final.reduce((a, b) => a + b, 0), 20000); assert.ok(h.actions.every((a) => a.source === 'scripted')); }
  assert.equal(rep.totals.solverActions, 0); assert.ok(rep.totals.scriptedActions > 100); assert.equal(rep.executor.counts.scripted, rep.totals.scriptedActions); assert.equal(rep.executor.counts.executed, 0, 'scripted actions are never counted as solver executions');
  assert.ok(rep.latencyMs.cycle.n > 100 && rep.capture.valid > 100 && rep.capture.invalid === 0);
});
test('the reconstructed history equals what the oracle table really did; replay with the same seed is identical', async () => {
  const run = async () => { const { p, table } = pipe({ seed: 31 }); const rep = await p.run(5); return { hands: p.hands.map((h) => h.actions.map((a) => [a.seat, a.street, a.type, a.amount])), stacks: table.players.map((q) => q.stack), completed: rep.completed }; };
  const a = await run(), b = await run(); assert.deepEqual(a, b); assert.equal(a.completed, 5);
  // independent audit: replay the logged actions on a fresh simulator and compare final stacks
  const t = new EM.Table(1, 31), { p } = pipe({ table: t, seed: 31 }); await p.run(5); const fresh = new EM.Table(1, 31);
  for (const h of p.hands) { fresh.startHand(); for (const x of h.actions) fresh.execute(fresh.request(x.type, x.amount, 0), 0); assert.equal(fresh.status, 'complete'); }
  assert.deepEqual(fresh.players.map((q) => q.stack), t.players.map((q) => q.stack));
});
test('real EightMax decisions where available, with exact attribution of everything else (preflop study + on-demand postflop studies)', async () => {
  const src = preflopAndPostflop(), { p, table } = pipe({ seed: 77, decisionSource: src, scriptedWhen: null });
  const rep = await p.run(8); assert.equal(rep.completed, 8); assert.equal(total(table), 20000);
  assert.ok(rep.totals.solverActions > 0, 'some decisions came from the solver'); const executed = p.hands.reduce((n, h) => n + h.actions.length, 0); assert.equal(executed, rep.totals.solverActions + rep.totals.scriptedActions);
  for (const h of p.hands) for (const a of h.actions) { if (a.source === 'solver') { assert.ok(a.studyId && a.labels && a.probabilities && a.recommended, 'solver actions carry their study, menu and probabilities'); assert.ok(Math.abs(a.probabilities.reduce((x, y) => x + y, 0) - 1) < 1e-6); } else assert.equal(a.studyId, null); }
  assert.equal(rep.executor.counts.executed, rep.totals.solverActions); assert.equal(rep.executor.counts.scripted, rep.totals.scriptedActions); assert.ok(rep.totals.scriptedActions === 0 || rep.unavailable.length > 0, 'every scripted action is explained by an "unavailable" reason');
  assert.ok(Object.keys(rep.attribution).every((k) => /^(preflop|flop|turn|river)\/(solver|scripted)$/.test(k)));
});
test('strict mode: without an allowed fallback a missing strategy suspends the hand with the reason; nothing is invented', async () => {
  const { p, table } = pipe({ seed: 9, decisionSource: none, allowScripted: false, scriptedWhen: null }); const rec = await p.playHand();
  assert.equal(rec.status, 'suspended'); assert.match(rec.reason, /no solver in this test.*no fallback allowed/); assert.equal(rec.actions.length, 0); assert.equal(table.actions, 0, 'no action reached the table'); assert.equal(p.report().unavailable[0].reason, 'no solver in this test');
});
test('Study Mode observes and recommends but never executes', async () => {
  const src = preflopAndPostflop(), { p, table } = pipe({ seed: 4, mode: 'study', decisionSource: src, scriptedWhen: null, allowScripted: false }); const rec = await p.playHand();
  assert.ok(['observed', 'suspended'].includes(rec.status)); assert.equal(table.actions, 0); assert.equal(p.executor.counts.executed + p.executor.counts.scripted, 0); assert.equal(rec.actions.length, 0);
});
test('emergency stop halts a hand mid-way: no action executes after it, the table state is frozen and consistent', async () => {
  const { p, table } = pipe({ seed: 12 }); const run = p.playHand(); while (p.totals.scriptedActions < 3) await new Promise((r) => setTimeout(r, 2));
  p.emergencyStop('test'); const rec = await run; assert.ok(['stopped', 'suspended', 'complete'].includes(rec.status)); const actions = table.actions; await new Promise((r) => setTimeout(r, 120)); assert.equal(table.actions, actions);
  const more = await p.executor.execute({ status: 'ok', source: 'eightmax-study', table: 1 }); assert.equal(more.status, 'blocked'); assert.match(more.reason, /Emergency stop/); table.validate();
});
test('restart mid-hand: checkpoint, new process objects, the same hand continues to a correct settlement', async () => {
  const { p, table } = pipe({ seed: 55 }); const run = p.playHand(); while (p.totals.scriptedActions < 4) await new Promise((r) => setTimeout(r, 2)); p.emergencyStop('checkpoint'); await run;
  const cp = JSON.parse(JSON.stringify(p.checkpoint())); if (table.status !== 'playing') return; // the hand ended before the stop: nothing to resume
  const client2 = new FH.OfflineClient(new EM.Table(1, 55)); client2.restoreTable(cp.oracle, 55);
  const p2 = new FH.SingleTablePipeline({ client: client2, vision: FH.makeVision(1), decisionSource: none, allowScripted: true, scriptedWhen: () => true, seed: 6, checkpoint: cp });
  const rep = await p2.run(2); assert.equal(rep.completed, 2); assert.equal(p2.hands[0].settlementOk, true); assert.equal(total(client2.table), 20000); client2.table.validate();
});
test('unreadable frames pause the table; consistent frames afterwards recover it and the hand still completes', async () => {
  const table = new EM.Table(1, 2), client = new FH.OfflineClient(table); let bad = 0, n = 0; const orig = client._render.bind(client);
  client._render = (w, id) => { n++; if (n >= 4 && n <= 6) { bad++; client.noise = 120; } else client.noise = 0; return orig(w, id); };
  const { p } = pipe({ table, client }); const rep = await p.run(2); assert.equal(rep.completed, 2); assert.ok(bad >= 3 && rep.totals.rejectedFrames >= 1, 'garbled frames were refused, not read'); assert.ok(p.hands[0].rejections.length >= 1); assert.equal(rep.totals.ackMismatches, 0);
});
test('a capture that keeps failing suspends the hand instead of acting on an old frame', async () => {
  const table = new EM.Table(1, 2), client = new FH.OfflineClient(table); const { p } = pipe({ table, client, maxFrameRetries: 3 }); let n = 0, calls = 0; const g = client.source.grab.bind(client.source);
  client.source.grab = async () => { calls++; if (++n > 3) return { ok: false, code: 'capture-failed', reason: 'device lost' }; return g(); };
  const rec = await p.playHand(); assert.equal(rec.status, 'suspended'); assert.match(rec.reason, /consistent reading|capture/); const acted = table.actions; assert.ok(acted <= 3, 'at most the actions taken before the outage: ' + acted);
});
test('animation guard: frames are read only after the screen stops changing', async () => {
  const table = new EM.Table(1, 6), client = new FH.OfflineClient(table); const g = client.source.grab.bind(client.source); let k = 0;
  client.source.grab = async () => { const r = await g(); if (k++ % 3 === 1 && r.ok) { const d = new Uint8ClampedArray(r.image.data); for (let i = 0; i < d.length; i += 4) { if ((i / 4) % 5 < 2) { d[i] = 255; d[i + 1] = 255; } } r.image = { width: r.image.width, height: r.image.height, data: d }; } return r; };
  const { p } = pipe({ table, client, stability: { required: 2, maxWaitFrames: 8 } }); const rep = await p.run(2); assert.equal(rep.completed, 2); assert.equal(rep.totals.ackMismatches, 0);
  const t2 = new EM.Table(1, 6), c2 = new FH.OfflineClient(t2), g2 = c2.source.grab.bind(c2.source); let j = 0; c2.source.grab = async () => { const r = await g2(); const d = new Uint8ClampedArray(r.image.data); for (let i = 0; i < d.length; i += 4) { d[i] = (d[i] + j * 121) & 255; d[i + 1] = (d[i + 1] + j * 83) & 255; } j++; r.image = { width: r.image.width, height: r.image.height, data: d }; return r; };
  const q = pipe({ table: t2, client: c2, stability: { required: 2, maxWaitFrames: 3 }, maxFrameRetries: 2 }); const rec = await q.p.playHand(); assert.equal(rec.status, 'suspended'); assert.ok((q.p.totals.animating || 0) >= 1, 'a screen that never settles is reported as animating'); assert.equal(t2.actions, 0);
});
test('stale decisions are never executed: a solver that answers for a different state is discarded and the hand is suspended after repeated misses', async () => {
  const liar = { decide: async (req) => ({ status: 'ok', source: 'eightmax-study', stateKey: 'not-this-state', labels: ['Fold'], probabilities: [1], recommendedSlot: 0, executable: [{ type: 'fold' }] }) };
  const { p, table } = pipe({ decisionSource: liar, allowScripted: false, scriptedWhen: null }); const rec = await p.playHand(); assert.equal(rec.status, 'suspended'); assert.match(rec.reason, /stale/i); assert.equal(table.actions, 0); assert.ok(p.totals.staleDecisions >= 5);
});
test('decision timeout: a solver that never answers times out, suspends strictly, or falls back with a label when allowed', async () => {
  const hang = { decide: () => new Promise(() => {}) };
  const a = pipe({ decisionSource: hang, allowScripted: false, scriptedWhen: null, deadlineMs: 80 }); const ra = await a.p.playHand(); assert.equal(ra.status, 'suspended'); assert.match(ra.reason, /timeout/i); assert.equal(a.table.actions, 0);
  const b = pipe({ decisionSource: hang, allowScripted: true, scriptedWhen: null, deadlineMs: 40, seed: 3 }); const rb = await b.p.playHand(); assert.equal(rb.status, 'complete'); assert.ok(rb.actions.every((x) => x.source === 'scripted')); assert.equal(rb.solverActions, 0); assert.ok(b.p.solver.info().stats.timeout >= 1);
});
test('Authorized QA mode end to end over HTTP: frames and actions cross a real network boundary, solver decisions only, every action acknowledged by the next frame', async () => {
  const srv = await startQaServer({ seed: 9 });
  try {
    const auth = { format: 'eightmax-qa-authorization', version: 1, environment: 'offline-qa-loopback', approvedBy: 'test operator', testEnvironmentOnly: true, noRealMoney: true, operatorOwnsTestClient: true, expiresAt: Date.now() + 3600e3, endpoint: srv.url + '/v1' };
    const qa = new QaHttpClient({ authorization: auth, token: srv.token }); const p = new FH.SingleTablePipeline({ tableId: 1, client: qa, vision: FH.makeVision(1), decisionSource: preflopAndPostflop(), mode: 'qa', authorization: auth, allowScripted: true });
    assert.ok((await qa.source.open()).ok); let completed = 0, suspended = 0; for (let h = 0; h < 6; h++) { const r = await p.playHand(); if (r.status === 'complete') completed++; else { suspended++; p.engine.reset(); p.executor.resumeTable(1); if (srv.table.status === 'playing') break; } }
    assert.ok(srv.stats.actions >= 3, 'solver actions reached the QA client: ' + srv.stats.actions); assert.equal(p.totals.scriptedActions, 0, 'scripted actions can never run in QA mode'); assert.equal(p.totals.ackMismatches, 0);
    assert.equal(srv.stats.unauthorized, 0); assert.equal(p.executor.counts.executed, srv.stats.actions); srv.table.validate();
    // authentication and origin rules
    const bad = await fetch(srv.url + '/v1/frame', { headers: { Authorization: 'Bearer wrong-token' } }); assert.equal(bad.status, 401); assert.throws(() => new QaHttpClient({ authorization: auth, token: 'short' }), /at least 8/);
    assert.deepEqual(await qa.transport('http://127.0.0.1:1/other', { idempotencyKey: 'k' }), { accepted: false, reason: 'Endpoint is not the authorized origin' });
    assert.throws(() => new QaHttpClient({ authorization: { ...auth, expiresAt: Date.now() - 1 }, token: srv.token }), /refused/);
  } finally { await srv.close(); }
});
test('QA interface protocol: idempotent actions, stale revisions refused, wrong hand refused, dropped acknowledgements become unconfirmed', async () => {
  const srv = await startQaServer({ seed: 3 }); const auth = { format: 'eightmax-qa-authorization', version: 1, environment: 'offline-qa-loopback', approvedBy: 'test operator', testEnvironmentOnly: true, noRealMoney: true, operatorOwnsTestClient: true, expiresAt: Date.now() + 3600e3, endpoint: srv.url + '/v1' };
  try {
    const qa = new QaHttpClient({ authorization: auth, token: srv.token, timeoutMs: 400 }); await qa.newHand(); const t = srv.table, base = { table: 1, hand: t.hand, actor: t.actor, revision: t.revision, action: 'call', amount: 100 };
    const a = await qa.transport(auth.endpoint, { ...base, idempotencyKey: 'key-0001' }); assert.equal(a.accepted, true); const again = await qa.transport(auth.endpoint, { ...base, idempotencyKey: 'key-0001' }); assert.equal(again.duplicate, true); assert.equal(srv.stats.actions, 1, 'the replay did not act twice');
    const stale = await qa.transport(auth.endpoint, { ...base, idempotencyKey: 'key-0002' }); assert.equal(stale.accepted, false); assert.match(stale.reason, /Stale revision/);
    const wrongHand = await qa.transport(auth.endpoint, { ...base, hand: t.hand + 5, revision: t.revision, idempotencyKey: 'key-0003' }); assert.equal(wrongHand.accepted, false); assert.match(wrongHand.reason, /Wrong hand/);
    srv.faults.dropAckApplied = 1; const lost = await qa.transport(auth.endpoint, { ...base, actor: t.actor, revision: t.revision, idempotencyKey: 'key-0004', action: t.legal().toCall > 0 ? 'call' : 'check', amount: 0 }); assert.equal(lost.accepted, false); assert.equal(lost.error, true);
    const retried = await qa.transport(auth.endpoint, { ...base, idempotencyKey: 'key-0004' }); assert.equal(retried.duplicate, true, 'retrying with the same key returns the original outcome');
    const nh = await fetch(srv.url + '/v1/new-hand', { method: 'POST', headers: { Authorization: 'Bearer ' + srv.token } }); assert.equal(nh.status, 409, 'a hand is in progress');
  } finally { await srv.close(); }
});
