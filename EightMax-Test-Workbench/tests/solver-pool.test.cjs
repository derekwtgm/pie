'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const { WorkerThreadSource } = require('../src/solver-pool.js'), SS = require('../src/solver-service.js'), FH = require('../src/full-hand.js'), EM = require('../src/engine.js');
const factory = path.join(__dirname, '../tools/solver-factory.cjs');
const req = (n, burn) => ({ format: 'eightmax-decision-request', version: 1, table: n, revision: 1, stateKey: 'k' + n, actor: 0, holeCards: [0, 5], board: [], actions: [], stacks: Array(8).fill(2500), priority: 1, deadlineMs: 20000, burnMs: burn });
const pool = (o = {}) => new WorkerThreadSource({ factory, factoryOptions: { kind: 'burn', burnMs: 50 }, size: 3, jobTimeoutMs: 800, ...o });

test('worker threads run decisions in parallel on separate cores', async () => {
  const p = pool({ size: 3 }); await p.ready();
  try { const t0 = Date.now(); const rs = await Promise.all([1, 2, 3].map((n) => p.decide(req(n, 300)))); const wall = Date.now() - t0; assert.ok(rs.every((r) => r.status === 'unavailable')); assert.ok(wall < 700, 'three 300 ms jobs overlapped: ' + wall + ' ms (serial would be 900)'); }
  finally { await p.close(); }
});
test('a runaway (never-yielding) solver is terminated and replaced; unrelated tables are unaffected', async () => {
  const p = pool({ size: 3, jobTimeoutMs: 500 }); await p.ready();
  try {
    const t0 = Date.now(); const [bad, a, b] = await Promise.all([p.decide(req(1, 60000)), p.decide(req(2, 40)), p.decide(req(3, 40))]);
    assert.equal(bad.status, 'error'); assert.match(bad.reason, /terminated/); assert.equal(a.status, 'unavailable'); assert.equal(b.status, 'unavailable'); assert.ok(Date.now() - t0 < 1500);
    const info = p.info(); assert.equal(info.timeouts, 1); assert.equal(info.respawns, 1); const after = await p.decide(req(4, 20)); assert.equal(after.status, 'unavailable', 'the replacement worker serves requests');
  } finally { await p.close(); }
});
test('the one-thread cooperative scheduler cannot do this: a synchronous runaway blocks the whole thread (why the pool exists)', async () => {
  const src = await require(factory).createSource({ kind: 'burn' }); const t0 = Date.now(); let ticks = 0; const iv = setInterval(() => { ticks++; }, 10);
  src.decide(req(1, 300)); await new Promise((r) => setTimeout(r, 20)); clearInterval(iv); assert.ok(Date.now() - t0 >= 300 && ticks <= 3, 'timers starved while the source computed: ticks=' + ticks);
});
test('stale jobs are really killed: cancelling a running decision terminates the worker, and the pool recovers', async () => {
  const p = pool({ size: 1, jobTimeoutMs: 30000 }); await p.ready(); let cancelled = false;
  try { const job = p.decide(req(1, 60000), { cancelled: () => cancelled }); setTimeout(() => { cancelled = true; }, 80); const r = await job; assert.equal(r.status, 'cancelled'); assert.equal(p.info().killedStale, 1); const ok = await p.decide(req(2, 20)); assert.equal(ok.status, 'unavailable'); }
  finally { await p.close(); }
});
test('queue bounds: overflow is refused explicitly, and queued jobs are cancelled before they start', async () => {
  const p = pool({ size: 1, maxQueue: 1, jobTimeoutMs: 5000 }); await p.ready();
  try { const first = p.decide(req(1, 200)); const queued = p.decide(req(2, 10)); const over = await p.decide(req(3, 10)); assert.equal(over.status, 'error'); assert.match(over.reason, /queue full/); assert.equal(p.info().rejectedFull, 1); await first; await queued; }
  finally { await p.close(); }
});
test('a crashed worker is replaced and only its own request fails', async () => {
  const p = new WorkerThreadSource({ factory: path.join(__dirname, 'crash-factory.cjs'), size: 2, jobTimeoutMs: 3000 }); await p.ready();
  try { const [a, b] = await Promise.all([p.decide({ ...req(1), crash: true }), p.decide(req(2))]); assert.equal(a.status, 'error'); assert.match(a.reason, /crash|exited|Worker/i); assert.equal(b.status, 'ok'); assert.ok(p.info().crashes >= 1); assert.equal((await p.decide(req(3))).status, 'ok'); }
  finally { await p.close(); }
});
test('a factory that fails to initialise is reported, not hidden', async () => {
  const p = new WorkerThreadSource({ factory: path.join(__dirname, 'does-not-exist.cjs'), size: 1 }); await assert.rejects(() => p.ready(), /failed to initialise/); await p.close();
});
test('multi-table isolation: one table\'s solver stalls, the other tables keep completing hands through the same pool', async () => {
  // table 2 is slow-poisoned: its requests spin forever; tables 1 and 3 get ordinary "unavailable" answers and use the labelled scripted policy
  const p = new WorkerThreadSource({ factory, factoryOptions: { kind: 'burn', burnMs: 5 }, size: 2, jobTimeoutMs: 400 }); await p.ready();
  const svc = new SS.SolverService({ decide: (r, ctx) => p.decide(r.table === 2 ? { ...r, burnMs: 60000 } : r, ctx), workers: 2, maxQueue: 16, maxPending: 1 });
  const mkp = (id) => new FH.SingleTablePipeline({ tableId: id, client: new FH.OfflineClient(new EM.Table(id, 40 + id)), vision: FH.makeVision(id), decisionSource: { decide: (r) => svc.submit(r).then((x) => (x.status === 'ok' ? x.decision : { status: x.status === 'unavailable' ? 'unavailable' : 'error', reason: x.reason })) }, allowScripted: true, seed: id, stopOnSuspend: false, deadlineMs: 20000 });
  try {
    const [p1, p2, p3] = [mkp(1), mkp(2), mkp(3)];
    // table 2 will not be allowed to fall back: it must stall, the others must not
    p2.o.allowScripted = false;
    const [r1, r2, r3] = await Promise.all([p1.run(2), p2.playHand().then((x) => ({ rec: x })), p3.run(2)]);
    assert.equal(r1.completed, 2); assert.equal(r3.completed, 2); assert.notEqual(r2.rec.status, 'complete'); assert.match(r2.rec.reason, /terminated|error|Solver/);
    assert.ok(p.info().timeouts >= 1 && p.info().respawns >= 1);
  } finally { svc.stop(); await p.close(); }
});
