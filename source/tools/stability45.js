'use strict';
// EightMax 4.5 (Priority 6): strategy stability of multiway postflop and tournament studies
// across random seeds, board textures, stack depths, betting abstractions and training budgets.
//
// For every scenario and training budget, `seeds` independent studies are trained (default
// trainer). Two things are measured after each budget:
//   * strategy quality: NashConv = sum of the exact unilateral best-response gains of all seats
//     inside the scenario's abstraction (exact best response, independent of training). For the
//     two-player chip-EV scenarios NashConv / 2 is the exact exploitability of the abstraction;
//     for every other scenario it is NOT exploitability.
//   * strategy stability: the average strategy of the root actor for each of its hands is read
//     from the explorer; `rootSpread` is the mean over hands and actions of the standard
//     deviation across seeds of the action probability (0 = every seed gives the same root
//     strategy), `rootMaxSpread` its maximum.
// A stable solver shows NashConv and rootSpread falling as the budget grows. A scenario whose
// spread stays high while NashConv is low has several near-equilibrium strategies (expected in
// multiplayer games: equilibria are not unique, and seeds may approach different ones).
// Nothing here is a statement about unrestricted poker: ranges are small and explicit so that
// the exact best response is tractable.
// usage: node tools/stability45.js <mwcli> <out.json> [--seeds=5] [--quick]
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
const E = require('./loadlib'); for (const l of ['lib_runouts', 'lib_wide', 'lib_river', 'lib_pushfold', 'lib_explorer']) require('../web/' + l);
const args = process.argv.slice(2), [cli, out] = args.filter(a => !a.startsWith('--')), quick = args.includes('--quick');
const nSeeds = +((args.find(a => a.startsWith('--seeds=')) || '').slice(8) || (quick ? 3 : 5));
if (!cli || !out) { console.error('usage: node tools/stability45.js <mwcli> <out.json> [--seeds=5] [--quick]'); process.exit(2); }
const base = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128 };
const R3 = ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc'];
const R3wet = ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc'];
const river = (bets, raises, maxBets) => ({ river: { bets, raises, maxBets } });
const scenarios = [
  // [key, group, description, config, budgets (sampled deals), two-player zero-sum]
  ['hu-river-dry', 'board texture', 'Heads-up river, paired dry board Ks8d5h2c2s', { board: 'Ks8d5h2c2s', common: 10, stacks: [20, 20], ranges: R3.slice(0, 2), streets: river('50,a', 'a', 2) }, [20000, 100000], true],
  ['hu-river-wet', 'board texture', 'Heads-up river, four-straight board 9d8c7h6s2c', { board: '9d8c7h6s2c', common: 10, stacks: [20, 20], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7d,AdQd,JdTd'], streets: river('50,a', 'a', 2) }, [20000, 100000], true],
  ['hu-river-flush', 'board texture', 'Heads-up river, three-flush board Kh8h5h2c2s', { board: 'Kh8h5h2c2s', common: 10, stacks: [20, 20], ranges: ['AhKs,KdQd,8s8d,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,Qh7h,AdQd,JdTd'], streets: river('50,a', 'a', 2) }, [20000, 100000], true],
  ['river3-shallow', 'stack depth', 'Three-player river, stacks 4 / 12 / 30 bb (side pots)', { board: 'Ks8d5h2c2s', common: 6, stacks: [4, 12, 30], ranges: R3, streets: river('75,a', 'a', 2) }, [20000, 100000], false],
  ['river3-deep', 'stack depth', 'Three-player river, stacks 40 / 40 / 40 bb', { board: 'Ks8d5h2c2s', common: 6, stacks: [40, 40, 40], ranges: R3wet, streets: river('75,a', 'a', 2) }, [20000, 100000], false],
  ['river3-jam', 'betting abstraction', 'Three-player river, all-in or fold only', { board: 'Ks8d5h2c2s', common: 6, stacks: [4, 12, 30], ranges: R3, streets: river('a', '', 1) }, [20000, 100000], false],
  ['river3-three-sizes', 'betting abstraction', 'Three-player river, bets 33 / 75 / all-in, raises 2.5x / all-in, three bets', { board: 'Ks8d5h2c2s', common: 6, stacks: [4, 12, 30], ranges: R3, streets: river('33,75,a', '2.5x,a', 3) }, [20000, 100000], false],
  ['turn4', 'multiway turn', 'Four-player turn and river, two bet sizes, raises, unequal stacks', { board: 'Qh9c4d2s', common: 8, stacks: [6, 14, 25, 40], ranges: ['AhQs,9h9d,KcJc', 'Kh9s,4h4c,JdTd', 'AcAd,Qc8c,7s6s', 'QdJh,5d3d,Ks2h'], streets: { turn: { bets: '50,a', raises: 'a', maxBets: 2 }, river: { bets: '75,a', raises: 'a', maxBets: 1 } } }, [20000, 60000], false],
  ['flop5', 'multiway flop', 'Five-player flop, weighted ranges, short stacks, all-in or fold', { board: 'Qs9h4d', dealt: 8, common: 1.5, stacks: [9, 26, 40, 15, 6], prior: Array(5).fill(2.2), folded: [1, 2.2, 2.2], ranges: ['AsQd:0.75,9c9d', 'KsQh,JhTh:0.5', '4s4c,AdKd', 'QcJc:0.6,8s7s', 'AhAc,Td9d:0.4'], streets: { flop: { bets: 'a', raises: '', maxBets: 1 } } }, [20000, 60000], false],
  ['flop6', 'multiway flop', 'Six-player flop, stacks 3 to 50 bb, multiway all-ins', { board: 'Td7c2h', dealt: 8, common: 1.5, stacks: [20, 35, 8, 50, 14, 3], prior: Array(6).fill(2.5), folded: [1, 2.5], ranges: ['AhTh,7s7d', 'KdTs,9c8c', 'QsQd,Ac7h', 'JhTc,6s5s', 'AdKc,2s2d', '8h8d,As2c'], streets: { flop: { bets: 'a', raises: '', maxBets: 1 } } }, [20000, 60000], false],
  ['bubble4', 'tournament ICM', 'Four-player bubble push/fold, weighted ranges, 4 bb stack (3 paid)', { preflop: { mode: 'shove' }, dealt: 4, common: 0, board: '', stacks: [12, 7, 20, 4], ranges: ['AsAh,7c2d:0.5', 'KsKh:0.75,8c3d', 'QsQh,6d5d', 'JsJh:0.5,9s8s'], icm: { payouts: [50, 30, 20] }, batchDeals: 4, actionStreams: 'deal' }, [20000, 60000], false],
  ['final8', 'tournament ICM', 'Eight-player final table push/fold, fixed hands (8 paid)', { preflop: { mode: 'shove' }, board: '', dealt: 8, common: 0, stacks: [30, 22, 15, 40, 9, 18, 25, 12], ranges: ['AsAh', 'KsKh', 'QsQh', 'JsJh', 'TsTh', '9s9h', '8s8h', '7s7h'], icm: { payouts: [30, 20, 14, 11, 9, 7, 5, 4] }, batchDeals: 4, actionStreams: 'deal' }, [20000, 60000], false],
].filter(s => !quick || /hu-river-dry|river3-shallow|bubble4/.test(s[0]));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em45-stab-'));
const run = a => JSON.parse(cp.execFileSync(cli, a.map(String), { encoding: 'utf8', maxBuffer: 256 << 20 }));
const stats = v => { const n = v.length, m = v.reduce((a, b) => a + b, 0) / n, sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : 0; return { mean: m, sd, min: Math.min(...v), max: Math.max(...v), n }; };
const report = { tool: 'stability45', generated: new Date().toISOString(), cpu: os.cpus()[0].model, seeds: nSeeds, scenarios: [],
  method: 'default trainer; exact best response of every seat after each budget; root average strategy per hand from the explorer; spread = standard deviation across seeds' };
for (const [key, group, description, cfg, budgets, zeroSum] of scenarios) {
  const perBudget = budgets.map(() => ({ nash: [], roots: [], seconds: [] }));
  for (let seed = 1; seed <= nSeeds; seed++) {
    const spec = path.join(dir, 'spec.json'), st = path.join(dir, 'state'), q = path.join(dir, 'q.json'), nq = path.join(dir, 'n.json');
    const game = E.MultiwayGame({ ...base, ...cfg, privateSeed: seed }), specJson = game.nativeSpec(); fs.writeFileSync(spec, JSON.stringify(specJson));
    const batch = specJson.batchDeals || 1; let deals = 0;
    budgets.forEach((target, b) => {
      const info = run([spec, Math.round((target - deals) / batch), 4, st + '.next', 512, ...(deals ? [st] : [])]); fs.renameSync(st + '.next', st); deals = target;
      fs.writeFileSync(q, JSON.stringify({ method: 'exact', timeLimitMs: 3600000, maxVisits: 2000000000 }));
      const g = run(['--gain', spec, st, q]);
      fs.writeFileSync(nq, JSON.stringify({ path: [], limit: 2000 }));
      const node = run(['--node', spec, st, nq]);
      perBudget[b].nash.push(g.nashConv); perBudget[b].seconds.push(info.wallSeconds);
      perBudget[b].roots.push(node.hands.items.filter(h => !h.blocked && h.row).map(h => h.average));
    });
  }
  const rows = budgets.map((deals, b) => {
    const R = perBudget[b].roots, hands = Math.min(...R.map(r => r.length)), sds = [];
    for (let h = 0; h < hands; h++) for (let a = 0; a < R[0][h].length; a++) sds.push(stats(R.map(r => r[h][a])).sd);
    return { sampledDeals: deals, nashConv: stats(perBudget[b].nash), ...(zeroSum ? { exploitability: stats(perBudget[b].nash.map(x => x / 2)) } : {}), rootSpread: sds.length ? sds.reduce((a, b) => a + b, 0) / sds.length : null, rootMaxSpread: sds.length ? Math.max(...sds) : null, rootHands: hands, trainingSeconds: stats(perBudget[b].seconds).mean };
  });
  report.scenarios.push({ key, group, description, twoPlayerZeroSum: zeroSum, metric: zeroSum ? 'NashConv / 2 = exact exploitability of this abstraction' : 'NashConv = sum of exact unilateral gains inside this abstraction (NOT exploitability)', budgets: rows,
    nashConvFalls: rows[rows.length - 1].nashConv.mean < rows[0].nashConv.mean, rootSpreadFalls: rows[rows.length - 1].rootSpread <= rows[0].rootSpread });
  console.log(key.padEnd(20), rows.map(r => `${r.sampledDeals}: NashConv ${r.nashConv.mean.toExponential(2)} (sd ${r.nashConv.sd.toExponential(1)}), root spread ${r.rootSpread == null ? '-' : r.rootSpread.toFixed(4)} max ${r.rootMaxSpread == null ? '-' : r.rootMaxSpread.toFixed(3)}`).join('  |  '));
}
report.summary = { scenarios: report.scenarios.length, nashConvFallsWithBudget: report.scenarios.filter(s => s.nashConvFalls).length, rootSpreadFallsWithBudget: report.scenarios.filter(s => s.rootSpreadFalls).length };
fs.writeFileSync(out, JSON.stringify(report, null, 1)); fs.rmSync(dir, { recursive: true, force: true });
console.log('wrote', out, JSON.stringify(report.summary));
