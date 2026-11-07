'use strict';
// Chart validation report (EightMax 2.9). Does not modify any chart.
// Usage: node tools/chart_validation29.js <out.json> [--updates=20000] [--depths=15,25]
// 1. Audit: what each 15-100 bb chart is (solved model game, fitted continuation values).
// 2. Independent comparison: first-in opening frequency per position from the shipped
//    chart vs the linked preflop-to-river solver, which plays flop, turn and river with
//    real cards (one bet size per street) instead of the chart's fitted realization model.
//    Two training seeds give the linked solver's sampling spread.
// 3. Reproducibility: re-solving one depth with the shipped generator.
process.env.EXTRA_LIBS = 'lib_deep.js,lib_deeplib.js';
const fs = require('fs'), path = require('path'), os = require('os');
const E = require('./loadlib.js'); for (const l of ['lib_runouts', 'lib_wide', 'lib_river']) require(path.join(__dirname, '../web', l + '.js'));
const out = process.argv[2], opt = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const updates = +opt('updates', 20000), depths = opt('depths', '15,25').split(',').map(Number);
const L = E.DEEP_LIB, un = (s) => s.replace(/\.(.)(.)/g, (_, c, n) => c.repeat(L.alph.indexOf(n) + 4)), pos = E.pfPositions(8);
const report = { generated: new Date().toISOString(), cpu: os.cpus()[0].model, audit: {
  charts: L.depths, base: L.base, meta: L.meta,
  kind: 'Each chart is an equilibrium of a preflop-only model game (169 hand classes, pairwise card removal, at most three voluntary entrants, fixed sizes per depth) whose postflop values come from a fitted equity-realization model (lib_deep.js BONUS_FIT / playFeatures). Values marked "ex" are the model game exploitability after quantization, not distance to full-game equilibrium.',
  estimated: 'postflop continuation values (fitted realization coefficients); the three-entrant cap; fixed raise sizes',
  calculated: 'preflop equilibrium of the model game; ante 0.1 bb per dealt seat (2.3 bb starting pot at 8 dealt); blinds 0.5/1' }, depths: [] };
for (const S of depths) {
  const m = E.DeepTree({ n: 8, stack: S, anteType: 'classic', ante: 0.1 }); m.load(un(L.data[S]));
  const chart = pos.slice(0, 7).map((p, seat) => { const v = m.view(m.firstIn(seat)); const agg = v.actions.filter((a) => a.kind >= 2).reduce((x, a) => x + a.pct, 0), limp = v.actions.filter((a) => a.kind === 1).reduce((x, a) => x + a.pct, 0); return { position: p, raisePct: agg, limpPct: limp }; });
  const sizes = E.deepDefaultSizes(S), seeds = [];
  for (const seed of [17, 29]) {
    const cfg = { preflop: { mode: 'linked', opens: String(sizes.open) + ',' + String(sizes.sbOpen), raises: '3x,a', maxBets: 3, limps: false }, board: '', dealt: 8, common: 0, stacks: Array(8).fill(S), ranges: Array(8).fill('random'),
      streets: { flop: { bets: '50', raises: '', maxBets: 1 }, turn: { bets: '75', raises: '', maxBets: 1 }, river: { bets: '100', raises: '', maxBets: 1 } }, privateMode: 'sampled', evaluationDeals: 2048, privateSeed: seed, batchDeals: 4, strategyBudgetMiB: 256 };
    const g = E.MultiwayGame(cfg), t0 = Date.now();
    const read = () => { const freq = []; let path = [];
      for (let seat = 0; seat < 7; seat++) {
        const v = g.view(path); if (v.kind !== 'player' || v.seat !== seat) break;
        const fold = v.actions.findIndex((a) => a.label === 'Fold');
        freq.push({ position: pos[seat], raisePct: 100 * v.actions.filter((a) => /^Raise|^All-in|^Bet/.test(a.label)).reduce((x, a) => x + a.frequency, 0), limpPct: 100 * v.actions.filter((a) => /^Call|^Check/.test(a.label)).reduce((x, a) => x + a.frequency, 0) });
        path = [...path, fold];
      }
      return freq; };
    g.iterate(Math.round(updates / 3)); const earlyUpdates = g.iterations, early = read(); g.iterate(updates - Math.round(updates / 3));
    seeds.push({ seed, seconds: (Date.now() - t0) / 1000, freq: read(), earlyUpdates, early, completedUpdates: g.iterations, memoryBudgetReached: g.limitReached, strategyMiB: g.strategyMiB });
    process.stderr.write(`${S} bb seed ${seed}: ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
  }
  const rows = chart.map((c, i) => ({ position: c.position, chartRaisePct: c.raisePct, chartLimpPct: c.limpPct, linkedRaisePct: seeds.map((s) => s.freq[i]?.raisePct), linkedRaisePctAtOneThird: seeds.map((s) => s.early[i]?.raisePct), linkedLimpPct: seeds.map((s) => s.freq[i]?.limpPct) }));
  report.depths.push({ stack: S, sizes, requestedUpdates: updates, rows, seeds: seeds.map(({ seed, seconds, completedUpdates, earlyUpdates, memoryBudgetReached, strategyMiB }) => ({ seed, seconds, completedUpdates, earlyUpdates, memoryBudgetReached, strategyMiB })) });
  console.log(`\n${S} bb first-in open % (raise/jam; limp in brackets): chart vs linked solver (seeds 17, 29; completed ${seeds.map((x) => x.completedUpdates + (x.memoryBudgetReached ? ' [256 MiB budget reached]' : '')).join(' / ')} updates)`);
  for (const r of rows) console.log(`  ${r.position.padEnd(6)} chart ${r.chartRaisePct.toFixed(1).padStart(5)} [${r.chartLimpPct.toFixed(1)}]   linked ${r.linkedRaisePct.map((x) => x?.toFixed(1)).join(' / ')} (at ${seeds[0].earlyUpdates} updates: ${r.linkedRaisePctAtOneThird.map((x) => x?.toFixed(1)).join(' / ')})`);
}
report.note = 'The linked solver is an independent but also approximate reference: sampled training, Detailed hand groups, one postflop size per street, opens of the chart sizes with 3x/all-in raises. Differences show where the chart model and a played-out postflop disagree; they are not corrections, and no chart was changed.';
fs.writeFileSync(out, JSON.stringify(report, null, 1));
