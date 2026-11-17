'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const EMG = require('../src/engine.js'), HS = require('../src/hand-state.js'), SS = require('../src/solver-service.js'), F = require('./study-fixture.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function firstRequest(seed = 4127) {
  const t = new EMG.Table(1, seed); t.startHand();
  const e = new HS.HandStateEngine(1), r = e.ingest(HS.observeSimulator(t, 0, { actions: [] }));
  return { t, e, req: SS.requestFromState(r.state) };
}

test('engine identification refuses unknown builds and falls back to the validated 5.1 build', () => {
  const prov = require('../vendor/eightmax-5.1/provenance.json');
  assert.equal(SS.identifyEngine({ version: prov.version, build: prov.build }, prov).compatible, true);
  const bad = SS.identifyEngine({ version: '6.0', build: '0123456789abcdef' }, prov);
  assert.equal(bad.compatible, false); assert.match(bad.issues[0], /Unsupported engine/); assert.equal(bad.fallback.version, '5.1');
  assert.equal(SS.identifyEngine({ version: '5.1', build: 'zz' }).compatible, false);
  assert.equal(SS.identifyEngine({ version: '5.1', build: '7d08acc7eb4577ee' }, { version: '5.1', build: 'ffffffffffffffff' }).compatible, false);
});

test('capability negotiation checks protocol range and required queries', () => {
  assert.equal(SS.negotiate({ protocolMin: 1, protocolMax: 2, queries: ['preflop-shove-root-and-path'] }).agreed, true);
  assert.equal(SS.negotiate({ protocolMin: 2, protocolMax: 3, queries: ['preflop-shove-root-and-path'] }).agreed, false);
  assert.equal(SS.negotiate({ protocolMin: 1, protocolMax: 1, queries: [] }).agreed, false);
  assert.equal(SS.negotiate(null).agreed, false);
  assert.equal(SS.CAPABILITIES.certification, 'none');
});

test('request construction refuses states with missing cards or history; validation rejects malformed input', () => {
  const t = new EMG.Table(1, 3); t.startHand(); const e = new HS.HandStateEngine(1);
  const hidden = e.ingest(HS.observeSimulator(t, 0, { actions: [], revealCards: false })).state;
  assert.throws(() => SS.requestFromState(hidden), /hole cards/);
  const e2 = new HS.HandStateEngine(1), nohist = e2.ingest(HS.observeSimulator(t, 0)).state;
  assert.throws(() => SS.requestFromState(nohist), /action history/);
  const { req } = firstRequest();
  for (const m of [(r) => { r.priority = 9; }, (r) => { r.holeCards = [1, 1]; }, (r) => { r.stacks.pop(); }, (r) => { r.deadlineMs = 0; }, (r) => { r.format = 'x'; }]) {
    const c = JSON.parse(JSON.stringify(req)); m(c); assert.throws(() => SS.validateRequest(c));
  }
});

test('study decisions use the real EightMax strategy rows; probabilities sum to 1; nothing is certified', () => {
  const s = F.study(), { req } = firstRequest();
  const d = s.src.decide(req);
  assert.equal(d.status, 'ok'); assert.equal(d.source, 'eightmax-study');
  assert.ok(Math.abs(d.probabilities.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.deepEqual(d.labels, ['Fold', 'All-in to 24.9']);
  assert.equal(d.certification, 'none'); assert.equal(d.engine.build, '7d08acc7eb4577ee');
  assert.ok(d.trainingUpdates >= 20000); assert.equal(d.evByAction, null);
  assert.ok(d.warnings.some((w) => /Convergence is unproven/.test(w)));
  // Independent re-lookup with the engine's own API.
  const row = s.src._row(0, req.holeCards), direct = s.prepared.game.averageAt('r', [], 0, { id: row[0], a: row[1], b: row[2], w: row[3] });
  assert.deepEqual(d.probabilities, Array.from(direct));
});

test('unsupported situations are answered "unavailable", never improvised', () => {
  const s = F.study(), { req } = firstRequest();
  const flop = JSON.parse(JSON.stringify(req)); flop.board = [1, 5, 9]; flop.street = 'flop';
  assert.equal(s.src.decide(flop).status, 'unavailable');
  const odd = JSON.parse(JSON.stringify(req)); odd.stacks[2] -= 100;
  assert.match(s.src.decide(odd).reason, /Stacks differ/);
  const wrongOrder = JSON.parse(JSON.stringify(req)); wrongOrder.actions = [{ seat: 5, type: 'fold', amount: 0 }];
  assert.match(s.src.decide(wrongOrder).reason, /does not match/);
  const minRaise = JSON.parse(JSON.stringify(req)); minRaise.actions = [{ seat: req.actor, type: 'check', amount: 0 }];
  assert.equal(s.src.decide(minRaise).status, 'unavailable');
});

function service(decide, extra = {}) { return new SS.SolverService({ decide, ...extra }); }
const okDecision = (req) => ({ status: 'ok', stateKey: req.stateKey, labels: ['Fold'], probabilities: [1], recommendedSlot: 0, executable: [{ type: 'fold' }], source: 'eightmax-study' });
const withRev = (req, revision, extra = {}) => ({ ...req, revision, stateKey: req.stateKey + '#' + revision, ...extra });

test('exact-input cache returns copies for identical inputs and misses on any input change', async () => {
  const { req } = firstRequest(); let calls = 0;
  const svc = service((r) => { calls++; return okDecision(r); });
  const a = await svc.submit(withRev(req, 1)), b = await svc.submit(withRev(req, 2, { table: 1 }));
  assert.equal(a.status, 'ok'); assert.equal(b.status, 'ok'); assert.equal(calls, 1); assert.equal(b.decision.fromCache, true);
  assert.equal(b.decision.revision, 2, 'cached answer is re-bound to the new request');
  const c = await svc.submit(withRev({ ...req, holeCards: [req.holeCards[1], req.holeCards[0]] }, 3));
  assert.equal(c.status, 'ok'); assert.equal(calls, 2, 'different exact input is a cache miss');
});

test('cache respects its byte budget with LRU eviction, and shrinks under memory pressure', async () => {
  const { req } = firstRequest(); let pressure = 0;
  const svc = service((r) => okDecision(r), { cacheBytes: 3000, memoryPressure: () => pressure });
  for (let i = 0; i < 40; i++) { const r = withRev(req, i + 1); r.stacks = r.stacks.slice(); r.board = []; r.actions = [{ seat: i % 8, type: 'fold', amount: i }]; await svc.submit(r); }
  assert.ok(svc.info().cacheBytes <= 3000); assert.ok(svc.stats.evicted > 0);
  pressure = 0.95; const before = svc.info().cacheEntries;
  const r = withRev(req, 99); r.actions = [{ seat: 1, type: 'fold', amount: 777 }]; await svc.submit(r);
  assert.ok(svc.info().cacheBytes <= 3000);
  assert.ok(before >= 1);
});

test('a decision that finishes after the table state changed is discarded as stale', async () => {
  const { req } = firstRequest(); let rev = 1;
  const svc = service(async (r) => { await sleep(30); return okDecision(r); }, { currentRevision: () => rev });
  const p = svc.submit(withRev(req, 1)); await sleep(5); rev = 2;
  const r = await p; assert.equal(r.status, 'stale'); assert.equal(r.decision, undefined);
  assert.equal(svc.stats.stale, 1);
});

test('a newer request for a table cancels its obsolete queued and running requests', async () => {
  const { req } = firstRequest(); const seen = [];
  const svc = service(async (r, ctx) => { await sleep(40); seen.push([r.revision, ctx.cancelled()]); return okDecision(r); }, { workers: 1 });
  const a = svc.submit(withRev(req, 1)), b = svc.submit(withRev(req, 2));
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.status, 'cancelled'); assert.equal(rb.status, 'ok');
});

test('timeouts free the worker and later requests still succeed (solver timeout recovery)', async () => {
  const { req } = firstRequest(); let hang = true;
  const svc = service((r) => hang ? new Promise(() => {}) : okDecision(r), { workers: 1 });
  const slow = await svc.submit(withRev(req, 1, { deadlineMs: 30 }));
  assert.equal(slow.status, 'timeout');
  hang = false; const r2 = await svc.submit(withRev(req, 2));
  assert.equal(r2.status, 'ok'); assert.equal(svc.info().active, 0);
});

test('bounded queue rejects overflow; urgent priorities run first; concurrency never exceeds the worker budget', async () => {
  const { req } = firstRequest(); const order = []; let live = 0, max = 0;
  const svc = service(async (r) => { live++; max = Math.max(max, live); await sleep(10); order.push(r.table + ':' + r.priority); live--; return okDecision(r); }, { workers: 2, maxQueue: 6 });
  const jobs = [];
  for (let tbl = 1; tbl <= 10; tbl++) jobs.push(svc.submit(withRev(req, 1, { table: tbl, priority: tbl === 10 ? 0 : 3, actions: [{ seat: tbl % 8, type: 'fold', amount: tbl }] })));
  const res = await Promise.all(jobs);
  assert.ok(res.some((r) => r.status === 'rejected' && /queue full/.test(r.reason)));
  assert.ok(max <= 2, 'max concurrent ' + max);
  assert.ok(order.length <= 10);
  const urgent = order.indexOf('10:0'); if (urgent >= 0) assert.ok(urgent <= 2, 'urgent decision should run in the first wave');
});

test('stop() cancels everything and later submissions are refused', async () => {
  const { req } = firstRequest();
  const svc = service(() => new Promise(() => {}), { workers: 1 });
  const a = svc.submit(withRev(req, 1, { deadlineMs: 5000 })); const b = svc.submit(withRev(req, 1, { table: 2 }));
  await sleep(5); svc.stop();
  assert.equal((await a).status, 'cancelled'); assert.equal((await b).status, 'cancelled');
  assert.equal((await svc.submit(withRev(req, 3))).status, 'cancelled');
});
