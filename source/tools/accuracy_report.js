'use strict';
// EightMax accuracy report. Every number in the output is recomputed by this
// script from the current source; nothing is copied from earlier runs.
// Usage: node tools/accuracy_report.js [output-dir] [--quick]
// Writes ACCURACY.json (all parameters, seeds, timings and hardware) and ACCURACY.txt.
//
// Terminology used in the report:
// - "exploitability" is used only for two-player zero-sum games, where it is an
//   exact distance from equilibrium (push/fold vs the oracle, heads-up postflop).
// - "exact unilateral gain" (multiway): the most one seat gains by a full best
//   response in the enumerated game while the others keep their strategies. Zero
//   for every seat means a Nash equilibrium of that configured tree; small values
//   do not imply uniqueness or that the strategy is GTO in any broader sense.
// - "tested response gain" (multiway sampled): a trained response, a LOWER bound
//   on the unilateral gain, with a standard error from evaluation sampling.
const fs = require('fs'), path = require('path'), os = require('os');
process.env.EXTRA_LIBS = 'lib_wasm.js,lib_postflop.js,lib_deep.js';
const EM = require('./loadlib.js');
for (const lib of ['lib_runouts', 'lib_wide', 'lib_river', 'lib_river_ui']) require(path.join(__dirname, '../web', lib + '.js'));
const { oracle } = require('./pf_oracle.js');
const quick = process.argv.includes('--quick');
const out = path.resolve(process.argv.slice(2).find((x) => !x.startsWith('--')) || '.');
const VERSION = fs.readFileSync(path.join(__dirname, '../VERSION'), 'utf8').trim();
const report = { version: VERSION, generated: new Date().toISOString(), quick,
  environment: { node: process.version, platform: os.platform() + ' ' + os.release() + ' ' + os.arch(), cpu: os.cpus()[0]?.model, cores: os.cpus().length, memoryGiB: +(os.totalmem() / 2 ** 30).toFixed(1) },
  sections: {} };
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
const time = (f) => { const t = process.hrtime.bigint(); const r = f(); return [r, Number(process.hrtime.bigint() - t) / 1e9]; };
const f = (x, d = 4) => Number(x).toFixed(d), e = (x) => Number(x).toExponential(1);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const T95 = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365 };
function ci(a) { // mean and 95% t-interval half-width across independent seeds
  const m = mean(a); if (a.length < 2) return { mean: m, half: null };
  const sd = Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
  return { mean: m, half: T95[a.length - 1] * sd / Math.sqrt(a.length) };
}
const RIVER3 = { board: 'Ks8d5h2c2s', common: 12, stacks: [30, 30, 30],
  ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc,QhJh,9c9d', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd,6h6d,4c3c', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc,6s5s,AdJd'],
  streets: { river: { bets: '50,125', raises: '2.5x', maxBets: 2 } } };

// 1. push/fold against the independent oracle (exact three-way card removal)
{
  const rows = [];
  say('1. Push/fold vs independent oracle (3-handed, exact card removal; two-player-style exploitability does not apply, gains are exact unilateral gains)');
  for (const cfg of [
    { n: 3, stacks: [10, 10, 10], anteType: 'classic', ante: 0.1, model: 'chip' },
    { n: 3, stacks: [6, 14, 9], anteType: 'bba', ante: 1, model: 'icm', payouts: [50, 30, 20] },
    { n: 3, stacks: [20, 4, 12], anteType: 'none', model: 'icm', payouts: [65, 35] }]) {
    const params = { maxIter: 3000, tol: 1e-9 };
    const [, solveSeconds] = time(() => null);
    const g = EM.PushFold(cfg); const [, secs0] = time(() => g.solve(params));
    const sol = g.results(), claimed = Array.from(g.exploitability().gains), v = Array.from(g.values());
    const [o, secs] = time(() => oracle(EM, cfg, sol));
    const unit = cfg.model === 'icm' ? 'prize units of ' + cfg.payouts.reduce((a, b) => a + b, 0) : 'bb';
    rows.push({ cfg, params, unit, solverEV: v, oracleEV: o.ev, solverReportedGain: claimed, exactGain: o.gain, solveSeconds: secs0 + solveSeconds, oracleSeconds: secs });
    say(`   ${cfg.model} ${cfg.stacks.join('/')} ${cfg.anteType}: EV gap ${f(Math.max(...v.map((x, p) => Math.abs(x - o.ev[p]))))} ${unit}; solver-reported gain ${e(Math.max(...claimed))}, oracle exact gain ${e(Math.max(...o.gain))}`);
  }
  report.sections.pushfoldOracle = { note: 'The solver models card removal pairwise; the oracle removes all three hands exactly. The oracle gain is each seat\'s exact best-response gain in the full push/fold game.', rows };
}

// 2. heads-up postflop: JavaScript and WebAssembly engines on the same river spot (two-player zero-sum: true exploitability)
{
  say('2. Heads-up postflop exploitability (two-player zero-sum), JS and WebAssembly engines');
  const R = '23456789TJQKA', S = 'cdhs', card = (s) => R.indexOf(s[0]) * 4 + S.indexOf(s[1]);
  const board = ['Ks', '9d', '6c', '2h', 'Js'].map(card);
  let seed = 3; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const ranges = [0, 1].map(() => Float32Array.from({ length: 1326 }, () => (rnd() < 0.25 ? 1 : 0)));
  const cfg = { board, pot: 10, stack: 40, maxBets: 3, forceAllin: 0.2, ranges, iso: 1, gpu: 0,
    sizes: { bet: [['', ''], ['', ''], ['50,100', '50,100']], raise: [['', ''], ['', ''], ['a', 'a']] } };
  const res = {};
  for (const engine of ['js', 'wasm']) {
    const rows = [];
    const g = EM.PostflopGame({ ...EM.postflopEngineCfg(cfg), engine }); let done = 0;
    for (const it of quick ? [100, 500] : [100, 500, 2000]) { const [, secs] = time(() => g.iterate(it - done)); done = it; const ex = g.exploitability(); rows.push({ iterations: it, exploitPctPot: ex.pct ?? ex, seconds: secs }); }
    res[engine] = { engine: g.engine, rows };
  }
  report.sections.headsUp = { rangeSeed: 3, rangeDensity: 0.25, ...res };
  say('   ' + ['js', 'wasm'].map((k) => `${res[k].engine}: ` + res[k].rows.map((r) => `${r.iterations} it ${f(r.exploitPctPot, 4)}% pot`).join(', ')).join(' | '));
}

// 3. reference game with a known analytic equilibrium, solved by the multiway engine
{
  say('3. Known-solution reference: polarized river (AsAd/KsTh vs QhQd, pot 10, all-in 10)');
  const g = EM.MultiwayGame({ board: '2c4d7h9sJc', common: 10, stacks: [10, 10], ranges: ['QhQd', 'AsAd,KsTh'], lead: [false, true], bets: 'a', raises: '', maxBets: 1, privateMode: 'exact' });
  g.iterate(3000);
  const m = g.metrics(), bettor = g.view([0]), caller = g.view([0, 1]);
  const bluff = bettor.hands.find((h) => h.cards.startsWith('K')).mix[1], value = bettor.hands.find((h) => h.cards.startsWith('A')).mix[1], call = caller.hands[0].mix[1];
  // Theory: the bettor bluffs so the caller is indifferent (pot odds 1:2, bluff:value = 1:2 => KTs bets 1/2),
  // and the caller calls 1/2 so the bluff is indifferent; OOP's EV is 2.5.
  const row = { iterations: 3000, valueBet: value, bluffBet: bluff, call, oopEV: m.ev[0], theory: { valueBet: 1, bluffBet: 0.5, call: 0.5, oopEV: 2.5 }, maxGain: m.maxGain };
  report.sections.reference = row;
  say(`   value bet ${f(value, 4)} (1), bluff ${f(bluff, 4)} (0.5), call ${f(call, 4)} (0.5), OOP EV ${f(m.ev[0], 4)} (2.5); exact gain ${e(m.maxGain)}`);
}

// 4. multiway exact deals: exact unilateral gains vs iterations
{
  say('4. Three-player river, exact deal enumeration: exact unilateral best-response gain vs iterations');
  const g = EM.MultiwayGame({ ...RIVER3, privateMode: 'exact' }), rows = [];
  let done = 0, total = 0;
  for (const it of [100, 500, 1000, 2000, 5000]) { const [, secs] = time(() => g.iterate(it - done)); total += secs; done = it; const m = g.metrics(); rows.push({ iterations: it, gain: m.gain, maxGainBb: m.maxGain, seconds: total }); }
  report.sections.multiwayExact = { pot: 12, cfg: RIVER3, deals: g.metrics().deals, rows };
  say('   ' + rows.map((r) => `${r.iterations} it: ${f(r.maxGainBb, 5)} bb (${f(r.seconds, 1)} s)`).join(' · '));
}

// 5. sampled deals on the same spot: exact cross-check (strategy copied into the enumerated game)
{
  say('5. Same spot, sampled deals: exact unilateral gain of the sampled strategy, mean and 95% CI over seeds');
  const seeds = quick ? [1, 2, 3] : [1, 2, 3, 4, 5], its = quick ? [3000, 12000] : [3000, 12000, 48000], rows = [];
  for (const traversal of ['external', 'full']) for (const updates of traversal === 'full' && !quick ? ['simultaneous', 'alternating'] : ['simultaneous']) {
    const perIt = its.map(() => []), secs = its.map(() => []);
    for (const s of seeds) {
      const cfg = { ...RIVER3, privateMode: 'sampled', abstraction: 'exact', traversal, updates, evaluationDeals: 512, privateSeed: s };
      const g = EM.MultiwayGame(cfg); let done = 0, spent = 0;
      its.forEach((it, i) => { const [, t] = time(() => g.iterate(it - done)); spent += t; done = it; perIt[i].push(EM.exactCheckSampled(cfg, g).maxGain); secs[i].push(spent); });
    }
    its.forEach((it, i) => { const c = ci(perIt[i]); rows.push({ traversal, updates, iterations: it, seeds, maxGainBySeed: perIt[i], mean: c.mean, ci95: c.half, meanSeconds: mean(secs[i]) }); });
    say(`   ${traversal}/${updates}: ` + rows.filter((r) => r.traversal === traversal && r.updates === updates).map((r) => `${r.iterations} it ${f(r.mean, 3)} ± ${f(r.ci95, 3)} bb (${f(r.meanSeconds, 1)} s)`).join(' · '));
  }
  // Tested response (the only check available when a spot cannot be enumerated) compared with the exact answer.
  const cfg = { ...RIVER3, privateMode: 'sampled', abstraction: 'exact', traversal: 'full', evaluationDeals: 4096, privateSeed: 1 };
  const g = EM.MultiwayGame(cfg); g.iterate(12000);
  const exact = EM.exactCheckSampled(cfg, g), probes = [0, 1, 2].map((seat) => { const p = g.responseProbe(seat); p.iterate(quick ? 1000 : 4000); return p.finish(); });
  report.sections.sampled = { note: 'Sampled training evaluated exactly in the enumerated game. Earlier releases reported only tested responses, which understated the gain.', cfg: RIVER3, rows,
    probeVsExact: { iterations: 12000, seed: 1, exactGain: exact.gain, probe: probes.map((p) => ({ gain: p.gain, se: p.se, trainingDeals: p.trainingDeals })) } };
  say('   tested responses vs exact gain after 12000 it (seed 1): ' + probes.map((p, i) => `seat ${i + 1} ${f(p.gain, 3)}±${f(1.96 * p.se, 3)} vs ${f(exact.gain[i], 3)}`).join(', '));
}

// 6. eight-player sampled studies: tested responses (lower bounds; exact enumeration is impractical)
{
  say('6. Eight-player river preset (sampled): tested response gains, lower bounds with 95% intervals');
  const base = { ...EM.multiwaySpotConfig(EM.multiwayExample(8, 'River', 8)), privateMode: 'sampled', evaluationDeals: 1024 };
  const plan = EM.planMultiwayMode({ ...base, privateMode: 'auto' }), rows = [];
  for (const [seed, it] of quick ? [[17, 2000]] : [[17, 2000], [17, 8000], [23, 8000]]) {
    const g = EM.MultiwayGame({ ...base, privateSeed: seed }); const [, secs] = time(() => g.iterate(it));
    const probes = []; for (const seat of [0, 3, 7]) { const p = g.responseProbe(seat); p.iterate(quick ? 500 : 1500); probes.push({ seat, ...p.finish() }); }
    const m = g.metrics();
    rows.push({ seed, iterations: it, trainSeconds: secs, evSE: m.se, probes, strategyMiB: m.strategyMiB, algorithm: m.algorithm });
    say(`   seed ${seed}, ${it} it (${f(secs, 1)} s): ` + probes.map((p) => `seat ${p.seat + 1} ${f(p.gain, 3)}±${f(1.96 * p.se, 3)}`).join(', ') + ' bb');
  }
  report.sections.eightPlayer = { modeSelection: plan, rows, note: 'Exact enumeration is not available for this spot (' + plan.reason + '). Tested gains are lower bounds.' };
}

// 7. future-game ICM (FGS) invariants
{
  say('7. Future-game ICM (FGS) invariants');
  const pool = (v) => Array.from(v).reduce((a, b) => a + b, 0);
  const a = EM.PushFold({ n: 2, stacks: [12, 8], anteType: 'none', model: 'icm', payouts: [70, 30] }); a.solve({ maxIter: 1500, tol: 1e-7 });
  const b = EM.PushFold({ n: 2, stacks: [12, 8], anteType: 'none', model: 'icm', payouts: [70, 30], fgs: { depth: 1 } }); b.solve({ maxIter: 1500, tol: 1e-7 });
  const c = EM.PushFold({ n: 4, stacks: [4, 20, 15, 11], anteType: 'bba', ante: 1, model: 'icm', payouts: [50, 30, 20], fgs: { depth: 1 } }); c.solve({ maxIter: 1500, tol: 1e-7 });
  const huShift = Math.abs(a.values()[0] - b.values()[0]);
  report.sections.fgs = { headsUpValueShift: huShift, fourHandedPoolError: Math.abs(pool(c.values()) - 100) };
  say(`   heads-up (ICM linear) value shift ${f(huShift, 4)} of 100; 4-handed prize pool error ${e(report.sections.fgs.fourHandedPoolError)}`);
}

// 8. not regenerated here
report.sections.notRegenerated = { deepChartCalibration: 'The 15-100 bb chart realization fit (80 heads-up flop solves) is not recomputed by this report; its 2.5 figures are historical and are not repeated here as measured results. Regenerate with tools/gen_deep.js.' };
say('8. Not regenerated by this report: the 15-100 bb chart realization fit (see tools/gen_deep.js).');

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'ACCURACY.json'), JSON.stringify(report, null, 1));
fs.writeFileSync(path.join(out, 'ACCURACY.txt'), 'EightMax ' + report.version + ' accuracy report, ' + report.generated + '\n' +
  `Hardware: ${report.environment.cpu}, ${report.environment.cores} cores, ${report.environment.memoryGiB} GiB; ${report.environment.platform}; Node ${report.environment.node}\n\n` + lines.join('\n') + '\n');
console.log('wrote', path.join(out, 'ACCURACY.json'));
