'use strict';
// Accuracy report: measures how close each engine's output is to equilibrium, using checks
// that do not rely on the engine grading itself where possible.
// Usage: node tools/accuracy_report.js [output-dir]   (writes ACCURACY.json and ACCURACY.txt)
const fs = require('fs'), path = require('path');
process.env.EXTRA_LIBS = 'lib_wasm.js,lib_postflop.js,lib_deep.js';
const EM = require('./loadlib.js');
for (const lib of ['lib_runouts', 'lib_wide', 'lib_river']) require(path.join(__dirname, '../web', lib + '.js'));
const { oracle } = require('./pf_oracle.js');
const out = path.resolve(process.argv[2] || '.');
const report = { version: '2.5', generated: new Date().toISOString(), node: process.version, sections: {} };
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
const time = (f) => { const t = Date.now(); const r = f(); return [r, (Date.now() - t) / 1000]; };
const f = (x, d = 4) => Number(x).toFixed(d), e = (x) => Number(x).toExponential(1);

// 1. push/fold against the independent oracle (exact three-way card removal)
{
  const rows = [];
  say('1. Push/fold vs independent oracle (3-handed, exact card removal)');
  for (const cfg of [
    { n: 3, stacks: [10, 10, 10], anteType: 'classic', ante: 0.1, model: 'chip' },
    { n: 3, stacks: [6, 14, 9], anteType: 'bba', ante: 1, model: 'icm', payouts: [50, 30, 20] },
    { n: 3, stacks: [20, 4, 12], anteType: 'none', model: 'icm', payouts: [65, 35] }]) {
    const g = EM.PushFold(cfg); g.solve({ maxIter: 3000, tol: 1e-9 });
    const sol = g.results(), claimed = Array.from(g.exploitability().gains), v = Array.from(g.values());
    const [o, secs] = time(() => oracle(EM, cfg, sol));
    const unit = cfg.model === 'icm' ? 'prize units of ' + cfg.payouts.reduce((a, b) => a + b, 0) : 'bb';
    rows.push({ cfg, unit, solverEV: v, oracleEV: o.ev, claimedGain: claimed, exactGain: o.gain, seconds: secs });
    say(`   ${cfg.model} ${cfg.stacks.join('/')} ${cfg.anteType}: EV gap ${f(Math.max(...v.map((x, p) => Math.abs(x - o.ev[p]))))} ${unit}; claimed gain ${e(Math.max(...claimed))}, exact-game gain ${e(Math.max(...o.gain))}`);
  }
  report.sections.pushfoldOracle = { note: 'The solver models card removal pairwise; the oracle removes all three hands. The exact-game gain is the true exploitability of the solved strategy in the full game.', rows };
}

// 2. heads-up postflop: JavaScript and WebAssembly engines on the same river spot
{
  say('2. Heads-up postflop: JS and WebAssembly engines');
  const R = '23456789TJQKA', S = 'cdhs', card = s => R.indexOf(s[0]) * 4 + S.indexOf(s[1]);
  const board = ['Ks', '9d', '6c', '2h', 'Js'].map(card);
  let seed = 3; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const ranges = [0, 1].map(() => Float32Array.from({ length: 1326 }, () => (rnd() < 0.25 ? 1 : 0)));
  const cfg = { board, pot: 10, stack: 40, maxBets: 3, forceAllin: 0.2, ranges, iso: 1, gpu: 0,
    sizes: { bet: [['', ''], ['', ''], ['50,100', '50,100']], raise: [['', ''], ['', ''], ['a', 'a']] } };
  const res = {};
  for (const engine of ['js', 'wasm']) {
    const [g, secs] = time(() => { const g = EM.PostflopGame({ ...EM.postflopEngineCfg(cfg), engine }); g.iterate(500); return g; });
    const ex = g.exploitability();
    res[engine] = { engine: g.engine, exploitPctPot: ex.pct ?? ex, seconds: secs };
  }
  report.sections.headsUp = res;
  say(`   exploitability after 500 iterations: JS ${f(res.js.exploitPctPot, 4)}% of pot (${res.js.engine}), WASM ${f(res.wasm.exploitPctPot, 4)}% (${res.wasm.engine})`);
}

// 3. multiway exact mode: full unilateral best response vs iterations
{
  say('3. Three-player river, exact deals: full best-response gain vs iterations');
  const base = { board: 'Ks8d5h2c2s', common: 12, stacks: [30, 30, 30],
    ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc,QhJh,9c9d', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd,6h6d,4c3c', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc,6s5s,AdJd'],
    streets: { river: { bets: '50,125', raises: '2.5x', maxBets: 2 } }, privateMode: 'exact' };
  const g = EM.MultiwayGame(base), rows = [];
  let done = 0;
  for (const it of [100, 1000, 5000]) { g.iterate(it - done); done = it; const m = g.metrics(); rows.push({ iterations: it, maxGainBb: m.maxGain }); }
  report.sections.multiwayExact = { pot: 12, rows };
  say('   ' + rows.map(r => `${r.iterations} it: ${f(r.maxGainBb, 4)} bb`).join(' · '));
}

// 4. sampled multiway: tested responses (a lower bound) with seed spread
{
  say('4. Three-player river, sampled deals: tested best-response gain (lower bound)');
  const base = { board: 'Ks8d5h2c2s', common: 12, stacks: [30, 30, 30],
    ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc,QhJh,9c9d', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd,6h6d,4c3c', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc,6s5s,AdJd'],
    streets: { river: { bets: '50,125', raises: '2.5x', maxBets: 2 } }, privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 4096, evaluationSeed: 99 };
  const rows = [];
  for (const it of [3000, 12000]) {
    const gains = [];
    for (const s of [1, 2, 3, 4]) {
      const g = EM.MultiwayGame({ ...base, privateSeed: s }); g.iterate(it);
      let gain = 0; for (const seat of [0, 1, 2]) { const pr = g.responseProbe(seat); pr.iterate(4000); gain = Math.max(gain, pr.finish().gain); }
      gains.push(gain);
    }
    rows.push({ iterations: it, maxTestedGainBySeed: gains });
    say(`   ${it} it: worst tested gain per seed ${gains.map(x => f(x, 3)).join(' / ')} bb`);
  }
  report.sections.sampled = { note: 'A trained response is a lower bound on true exploitability; spread across seeds shows sampling noise.', rows };
}

// 5. future-game ICM invariants
{
  say('5. Future-game ICM (FGS) invariants');
  const pool = (v) => Array.from(v).reduce((a, b) => a + b, 0);
  const a = EM.PushFold({ n: 2, stacks: [12, 8], anteType: 'none', model: 'icm', payouts: [70, 30] }); a.solve({ maxIter: 1500, tol: 1e-7 });
  const b = EM.PushFold({ n: 2, stacks: [12, 8], anteType: 'none', model: 'icm', payouts: [70, 30], fgs: { depth: 1 } }); b.solve({ maxIter: 1500, tol: 1e-7 });
  const c = EM.PushFold({ n: 4, stacks: [4, 20, 15, 11], anteType: 'bba', ante: 1, model: 'icm', payouts: [50, 30, 20], fgs: { depth: 1 } }); c.solve({ maxIter: 1500, tol: 1e-7 });
  const huShift = Math.abs(a.values()[0] - b.values()[0]);
  report.sections.fgs = { headsUpValueShift: huShift, fourHandedPoolError: Math.abs(pool(c.values()) - 100) };
  say(`   heads-up (ICM linear) value shift ${f(huShift, 4)} of 100; 4-handed prize pool error ${e(report.sections.fgs.fourHandedPoolError)}`);
}

// 6. deep preflop realization fit (recorded from the 2.5 calibration run)
report.sections.deepCalibration = { flops: 20, spots: ['BTN vs BB 25bb', 'SB vs BB 25bb', 'BTN vs BB 60bb', 'SB vs BB 60bb'], solveExploitPctPot: 0.5,
  potShareRMSE: { rawEquity: 0.1162, model24: 0.1035, model25: 0.0747 }, heldOutFlops: { model24: [0.1270, 0.1016], model25: [0.1035, 0.0870] } };
say('6. Deep preflop realization: pot-share error 0.104 (2.4) -> 0.075 (2.5); held-out flops 0.127/0.102 -> 0.104/0.087');

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'ACCURACY.json'), JSON.stringify(report, null, 1));
fs.writeFileSync(path.join(out, 'ACCURACY.txt'), 'EightMax ' + report.version + ' accuracy report, ' + report.generated + '\n\n' + lines.join('\n') + '\n');
console.log('wrote', path.join(out, 'ACCURACY.json'));
