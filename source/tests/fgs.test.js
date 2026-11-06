'use strict';
const test = require('node:test');
const assert = require('node:assert');
const EM = require('../tools/loadlib.js');

function solve(cfg) { const g = EM.PushFold(cfg); g.solve({ maxIter: 1500, tol: 1e-7 }); return { r: g.results(), v: g.values() }; }

test('FGS barely changes heads-up play, where ICM is linear in chips', () => {
  const base = { n: 2, stacks: [12, 8], anteType: 'none', model: 'icm', payouts: [70, 30] };
  const a = solve(base), b = solve({ ...base, fgs: { depth: 1 } });
  assert.ok(Math.abs(a.r.jam[0].pct - b.r.jam[0].pct) < 2);
  assert.ok(Math.abs(a.v[0] - b.v[0]) < 0.1);
});

test('FGS conserves the prize pool and makes the next big blind jam wider', () => {
  const base = { n: 4, stacks: [4, 20, 15, 11], anteType: 'bba', ante: 1, model: 'icm', payouts: [50, 30, 20] };
  const a = solve(base), b = solve({ ...base, fgs: { depth: 1 } });
  const sum = Array.from(b.v).reduce((x, y) => x + y, 0);
  assert.ok(Math.abs(sum - 100) < 1e-6, 'sum ' + sum);
  assert.ok(b.r.jam[0].pct > a.r.jam[0].pct + 10, 'first seat posts the next big blind');
  assert.ok(b.v[0] < a.v[0], 'blind pressure lowers the short stack value');
  assert.ok(b.r.exploitRel < 1e-5);
});

test('FGS falls back to ICM when a survivor cannot post the next hand', () => {
  const r = solve({ n: 3, stacks: [1.6, 10, 10], anteType: 'bba', ante: 1, model: 'icm', payouts: [50, 30, 20], fgs: { depth: 1 } });
  const sum = Array.from(r.v).reduce((x, y) => x + y, 0);
  assert.ok(Math.abs(sum - 100) < 1e-6);
});

test('two-hand FGS is limited to small tables and stays consistent', () => {
  assert.throws(() => EM.PushFold({ n: 6, stacks: Array(6).fill(10), model: 'icm', payouts: [50, 30, 20], fgs: { depth: 2 } }), /4 players/);
  const r = solve({ n: 3, stacks: [6, 12, 9], anteType: 'bba', ante: 1, model: 'icm', payouts: [50, 30, 20], fgs: { depth: 2 } });
  assert.ok(Math.abs(Array.from(r.v).reduce((x, y) => x + y, 0) - 100) < 1e-6);
});

test('deep model uses the fitted realization constants and still accepts the 2.4 values', () => {
  process.env.EXTRA_LIBS = 'lib_deep.js';
  require('../web/lib_deep.js');
  const legacy = { delta: 0.05, aK: 0.6, gK: 2.2, kDeep: 0.1, agg: 0, mK: 0, bonus: [0.12, 0.22, 0.06, 0.12, 0.07, 0.03, -0.08, -0.06, -0.05] };
  const a = EM.DeepTree({ n: 2, stack: 40 }), b = EM.DeepTree({ n: 2, stack: 40, realization: legacy });
  a.solve({ maxIter: 1500, tol: 2e-3 }); b.solve({ maxIter: 1500, tol: 2e-3 });
  const open = m => m.view(0).actions.filter(x => x.kind >= 2).reduce((s, x) => s + x.pct, 0);
  assert.ok(Number.isFinite(open(a)) && Number.isFinite(open(b)));
  assert.ok(Math.abs(open(a) - open(b)) > 0.1, 'fitted constants change the solution');
  assert.ok(a.exploitability() < 0.0021);
});
