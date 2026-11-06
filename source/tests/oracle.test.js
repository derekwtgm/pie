'use strict';
// Independent push/fold oracle (tools/pf_oracle.js): exact three-way card removal, its own game
// tree, ICM and best response. Pins how far the solver's pairwise-removal model is from the
// exact game, and that the solver's exploitability report tracks the oracle's.
const test = require('node:test'), assert = require('node:assert');
const EM = require('../tools/loadlib.js'), { oracle, icmBrute } = require('../tools/pf_oracle.js');

test('oracle ICM agrees with the solver ICM, including busted players', () => {
  for (const [v, s, p] of [[[10, 0, 5], [10, 8, 7], [50, 30, 20]], [[0, 0, 30], [10, 10, 10], [60, 30, 10]], [[3, 9, 18], [3, 9, 18], [70, 30]]]) {
    const a = icmBrute(v, s, p), b = EM.icmWithBusts(v, s, p);
    a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < 1e-9));
  }
});

for (const cfg of [
  { n: 3, stacks: [10, 10, 10], anteType: 'classic', ante: 0.1, model: 'chip' },
  { n: 3, stacks: [6, 14, 9], anteType: 'bba', ante: 1, model: 'icm', payouts: [50, 30, 20] }]) {
  test('push/fold equilibrium checked by the independent oracle: ' + cfg.model, () => {
    const g = EM.PushFold(cfg); g.solve({ maxIter: 3000, tol: 1e-9 });
    const sol = g.results(), v = g.values(), o = oracle(EM, cfg, sol);
    const evTol = cfg.model === 'icm' ? 0.05 : 0.01, gainTol = 1e-3;
    for (let p = 0; p < 3; p++) {
      assert.ok(Math.abs(v[p] - o.ev[p]) < evTol, 'EV seat ' + p + ' ' + v[p] + ' vs ' + o.ev[p]);
      assert.ok(o.gain[p] < gainTol && o.gain[p] > -1e-9, 'exact-game gain seat ' + p + ' ' + o.gain[p]);
    }
    // a badly wrong strategy: both agree it is very exploitable
    const bad = { jam: sol.jam.map((j, i) => ({ freq: i === 0 ? new Float64Array(169).fill(1) : j.freq })), call: sol.call };
    const ob = oracle(EM, cfg, bad);
    g.load({ jam: bad.jam.map(j => j.freq), call: sol.call.map(r => r.map(c => c && c.freq)) });
    const sg = g.exploitability().gains;
    for (let p = 0; p < 3; p++) assert.ok(Math.abs(ob.gain[p] - sg[p]) < 0.1 * Math.max(ob.gain[p], 1e-3), 'seat ' + p + ' ' + ob.gain[p] + ' vs ' + sg[p]);
  });
}
