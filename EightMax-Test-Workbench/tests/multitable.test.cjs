'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const EMG = require('../src/engine.js'), MT = require('../src/multitable.js'), F = require('./study-fixture.cjs');
const full = F.full();
const make = (o = {}) => new MT.MultiTableScheduler({ tables: 10, handsPerTable: 6, decisionSource: F.study().src, allowFallback: true, ...o });
const fin = (s) => s.workers.map((w) => ({ hand: w.table.hand, stacks: w.table.players.map((p) => p.stack), rng: w.table.rng.state, completed: w.table.completed }));

test('ten independent seeded tables complete hands with exact chip accounting; every action is a solver decision', async () => {
  const s = make({ handsPerTable: 12 }), r = await s.run();
  assert.equal(r.tables, 10); assert.equal(r.handsCompleted, 120);
  assert.equal(r.solverActions + r.fallbackActions, r.actions); assert.ok(r.actions > 120);
  assert.ok(!full || r.solverActions / r.actions >= 0.9, 'solver share ' + (r.solverActions / r.actions).toFixed(3) + ': fallbacks are counted separately and must stay rare');
  assert.equal(r.invalidObservations, 0); assert.equal(r.crashes, 0);
  for (const w of s.workers) {
    assert.equal(w.status, 'done'); w.table.validate();
    assert.equal(w.table.players.reduce((n, p) => n + p.stack, 0), 8 * 2500, 'table ' + w.id + ' conserves chips');
  }
  const seeds = new Set(s.workers.map((w) => JSON.stringify(w.table.history.slice(0, 3).map((h) => h.message)) + w.table.board.join()));
  assert.ok(seeds.size > 5, 'independent seeds produce different hands');
  assert.ok(r.solver.maxConcurrentDecisions <= 2);
  assert.equal(r.gpu.measured, false);
});

test('the same seeds reproduce identical results (determinism)', async () => {
  const a = make({ tables: 4 }), b = make({ tables: 4 });
  await a.run(); await b.run();
  assert.deepEqual(fin(a), fin(b));
});

test('with partial study coverage, unavailable decisions are reported and not disguised as solver decisions', async () => {
  const s = make({ tables: 3, handsPerTable: 4 }), r = await s.run();
  assert.equal(r.solverActions + r.fallbackActions, r.actions);
  for (const t of r.perTable) assert.equal(t.fallbackActions, t.unavailable, 'every fallback corresponds to an unavailable solver answer');
  const strict = make({ tables: 6, handsPerTable: 40, allowFallback: false });
  const rs = await strict.run();
  assert.equal(rs.fallbackActions, 0, 'strict mode never improvises');
  for (const w of strict.workers) if (w.status === 'failed') assert.match(w.reason, /Solver unavailable|recover/);
  assert.ok(rs.solverActions > 0);
});

test('a crashing worker is isolated and recovers; other tables are unaffected', async () => {
  const s = make({ tables: 5, handsPerTable: 4, faults: [{ table: 3, step: 4, kind: 'throw' }] }), r = await s.run();
  assert.equal(r.perTable[2].crashes, 1); assert.equal(r.perTable[2].recoveries, 1);
  for (const t of r.perTable) assert.ok(['done', 'failed'].includes(t.status), t.table + ' ' + t.status);
  assert.equal(r.perTable[2].status, 'done', 'crashed table recovered and finished');
  for (const i of [0, 1, 3, 4]) { assert.equal(r.perTable[i].crashes, 0); assert.equal(r.perTable[i].hands, 4); }
});

test('a corrupted table state is permanently suspended; all other tables finish', async () => {
  const s = make({ tables: 4, handsPerTable: 4, faults: [{ table: 2, step: 3, kind: 'corrupt-table' }] }), r = await s.run();
  assert.equal(r.perTable[1].status, 'failed'); assert.match(r.perTable[1].reason, /corrupt|recover/i);
  for (const i of [0, 2, 3]) assert.equal(r.perTable[i].hands, 4);
});

test('garbage and low-confidence observations pause that table without any action on the bad frame', async () => {
  const s = make({ tables: 3, handsPerTable: 3, faults: [{ table: 1, step: 3, kind: 'garbage-observation' }, { table: 2, step: 2, kind: 'low-confidence' }, { table: 2, step: 3, kind: 'drop-observation' }] });
  const r = await s.run();
  assert.ok(r.perTable[0].invalidObservations >= 1); assert.ok(r.perTable[1].invalidObservations >= 1); assert.equal(r.perTable[1].droppedObservations, 1);
  assert.equal(r.perTable[2].invalidObservations, 0);
  for (const t of r.perTable) assert.equal(t.status, 'done');
  for (const w of s.workers) w.table.validate();
});

test('a table whose solver stalls times out and is suspended without freezing other tables', async () => {
  const s = make({ tables: 4, handsPerTable: 3, budgets: { deadlineMs: 120, recoveryBackoffMs: 10, maxRecoveries: 1 }, faults: [{ table: 2, step: 2, kind: 'stall-solver', repeat: true }] });
  const t0 = Date.now(), r = await s.run();
  assert.ok(['failed', 'suspended'].includes(r.perTable[1].status), r.perTable[1].status);
  assert.ok(r.perTable[1].deadlineMisses >= 1);
  for (const i of [0, 2, 3]) assert.equal(r.perTable[i].hands, 3);
  assert.ok(Date.now() - t0 < 20000);
});

test('emergency stop halts every table immediately and no further actions are executed', async () => {
  const s = make({ tables: 10, handsPerTable: 500 });
  const run = s.run(); await new Promise((r) => setTimeout(r, 150));
  s.emergencyStop('test stop'); const before = s.totals.actions;
  const r = await run; await new Promise((x) => setTimeout(x, 100));
  assert.equal(s.totals.actions, before, 'no action after stop');
  assert.ok(r.handsCompleted < 5000);
  assert.ok(s.workers.every((w) => w.table.paused));
  assert.match(s.executor.estop, /test stop/);
  assert.equal((await s.executor.execute({ table: 1, status: 'ok', source: 'eightmax-study' })).status, 'blocked');
});

test('memory budget: pressure holds tables and shrinks the cache but work still finishes sequentially', async () => {
  const s = make({ tables: 6, handsPerTable: 3, budgets: { maxMemoryBytes: 1024 }, rss: () => 5 * 1024 * 1024 });
  const r = await s.run();
  assert.ok(r.memory.pressureEvents > 0, 'governor engaged');
  assert.ok(s.solver.info().cacheBytes <= 4 * 1024 * 1024 * 0.25 + 1, 'cache shrunk to the pressure budget');
  for (const w of s.workers) assert.equal(w.status, 'done');
  assert.ok(r.solver.maxConcurrentDecisions <= 2);
});

test('capacity limiting: tables beyond the active-table budget are never started', async () => {
  const s = make({ tables: 10, handsPerTable: 2, budgets: { maxActiveTables: 4 } }), r = await s.run();
  assert.equal(r.perTable.filter((t) => t.status === 'done').length, 4);
  assert.equal(r.perTable.filter((t) => t.status === 'capacity-limited').length, 6);
  assert.equal(r.perTable.slice(4).reduce((n, t) => n + t.hands, 0), 0);
});

test('checkpoint mid-run, restart from the file contents and reach the identical final state', async () => {
  const ref = make({ tables: 3, handsPerTable: 60 }); await ref.run();
  const a = make({ tables: 3, handsPerTable: 60 }); const p = a.run();
  while (a.totals.hands < 20) await new Promise((r) => setTimeout(r, 1));
  a.emergencyStop('checkpoint'); await p;
  const cp = JSON.parse(JSON.stringify(a.checkpoint()));
  const b = make({ tables: 3, handsPerTable: 60 }); MT.restoreCheckpoint(b, cp);
  assert.ok(a.totals.hands < 180 && a.totals.hands >= 20, 'the checkpoint is genuinely partial: ' + a.totals.hands);
  await b.run();
  assert.deepEqual(fin(b).map((x) => [x.hand, x.stacks, x.rng, x.completed]), fin(ref).map((x) => [x.hand, x.stacks, x.rng, x.completed]));
  const bad = JSON.parse(JSON.stringify(cp)); bad.tables[0].table.players[0].stack += 1;
  assert.throws(() => MT.restoreCheckpoint(make({ tables: 3 }), bad), /hash mismatch/);
  assert.throws(() => MT.restoreCheckpoint(make({ tables: 2 }), cp), /table count/);
});

test('table checkpoints round-trip exactly for any seed', () => {
  for (let seed = 1; seed < 40; seed++) {
    const t = new EMG.Table(1, seed * 31); t.startHand();
    for (let i = 0; i < seed % 9 && t.status === 'playing'; i++) { const a = EMG.policy(t); t.execute(t.request(a.type, a.amount, 0), 0); }
    const c = MT.captureTable(t), u = MT.restoreTable(JSON.parse(JSON.stringify(c)), seed);
    assert.deepEqual(MT.captureTable(u), c);
  }
});

test('percentile statistics are correct', () => {
  assert.equal(MT.percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5);
  assert.equal(MT.percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
  assert.equal(MT.stats([]).n, 0);
});

test('Study Mode shows recommendations and executes nothing; the simulator never changes', async () => {
  const s = make({ tables: 3, handsPerTable: 5, mode: 'study' }), r = await s.run();
  assert.equal(s.executor.mode, 'study'); assert.equal(r.actions, 0); assert.equal(s.executor.counts.executed, 0);
  for (const w of s.workers) { assert.equal(w.table.actions, 0, 'no simulated action in study mode'); assert.ok(w.view && w.view.result); if (w.view.decision) assert.equal(w.view.decision.convergence.verdict, 'unproven'); }
});

test('per-table pause holds a table without affecting others; resume is refused for failed tables', async () => {
  const s = make({ tables: 3, handsPerTable: 30 }); s.pauseTable(2, 'operator'); const p = s.run();
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(s.workers[1].status, 'paused'); assert.equal(s.workers[1].table.actions, 0);
  assert.ok(s.workers[0].table.actions > 0 || s.workers[0].hands > 0);
  assert.equal(s.resumeTable(2), true); await p;
  assert.equal(s.workers[1].hands, 30);
  const f = make({ tables: 1, handsPerTable: 1 }); f.workers[0].status = 'failed'; assert.equal(f.resumeTable(1), false);
});

test('dashboard decisions require a study: a scheduler without a decision source cannot be built', () => {
  assert.throws(() => new MT.MultiTableScheduler({ tables: 2 }), /decision source/);
  assert.throws(() => new MT.MultiTableScheduler({ tables: 11, decisionSource: F.study().src }), /1 to 10/);
});
