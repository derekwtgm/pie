// EightMax 4.0 (Priority 7): does another existing training variant reach a
// better strategy per sampled deal or per second than the 3.9 default?
// usage: node tools/convergence40.js <mwcli> <out.json> [--quick]
//
// Variants (all already implemented in 3.9 and bit-identical in 4.0):
//   linear      - external-sampling MCCFR, linear averaging, standard regret matching (3.9 default)
//   dcfr        - discounted CFR alpha 1.5, beta 0, gamma 2 (3.3 option)
//   dcfr-b05    - discounted CFR alpha 1.5, beta 0.5, gamma 2
//   linear-plus - linear averaging with CFR+ regret flooring (regretMatching "plus")
// Games with exact evaluation: heads-up river and turn (exact exploitability),
// three-player river with chip EV and with ICM (exact NashConv = sum of exact
// per-seat best-response gains; no exploitability is claimed for 3 seats).
// Every variant trains the same games with the same seeds (privateSeed 1..5)
// to the same sampled-deal checkpoints; each segment resumes from the previous
// checkpoint. Strategy quality is measured independently of training by the
// exact best-response evaluator (never by training estimates). Reported per
// checkpoint: mean NashConv, t-based 95% half-width over seeds, min/max, and
// cumulative training seconds (accuracy at equal time is read across rows).
// A variant is only called better where its mean NashConv is lower than the
// default's and the paired per-seed differences have a 95% interval below 0.
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process');
const E = require('./loadlib'); for (const l of ['lib_runouts', 'lib_wide', 'lib_river']) require('../web/' + l);
const [cli, out] = process.argv.slice(2), quick = process.argv.includes('--quick');
const base = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128 };
const games = [
  ['Heads-up river (chip EV)', { board: 'Qs9h4d2c7s', common: 10, stacks: [40, 40], ranges: ['AsQd,KhQh,9s9c,JhTh,8d7d,AhKd,Ts8s,AcAd,5h5d', 'QcJc,TdTc,As4s,KdJd,6s5s,9d8d,7c7d,AhJh,Kc2s'], streets: { river: { bets: '50,a', raises: '2.5x', maxBets: 2 } } }],
  ['Heads-up turn (chip EV)', { board: 'Qs9h4d2c', common: 10, stacks: [40, 40], ranges: ['AsQd,KhQh,9s9c,JhTh,8d7d,AhKd', 'QcJc,TdTc,As4s,KdJd,6s5s,9d8d'], streets: { turn: { bets: '60', raises: '', maxBets: 1 }, river: { bets: '75,a', raises: '', maxBets: 1 } } }],
  ['Three-player river (chip EV)', { board: 'Ks8d5h2c2s', common: 12, stacks: [30, 30, 30], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc,QhJh,9c9d', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd,6h6d,4c3c', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc,6s5s,AdJd'], streets: { river: { bets: '50,125', raises: '2.5x', maxBets: 2 } } }],
  ['Three-player river, side pots (ICM)', { board: 'Ks8d5h2c2s', common: 6, stacks: [4, 12, 30], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc'], icm: { payouts: [50, 30, 20], others: [10] }, streets: { river: { bets: '75,a', raises: 'a', maxBets: 2 } } }],
];
const variants = [
  ['linear', {}], ['dcfr', { weighting: 'dcfr' }], ['dcfr-b05', { weighting: 'dcfr', dcfrBeta: 0.5 }], ['linear-plus', { regretMatching: 'plus' }],
];
const checkpoints = quick ? [10000, 40000] : [10000, 40000, 160000, 480000];
const seeds = quick ? [1, 2] : [1, 2, 3, 4, 5], threads = Math.min(4, os.cpus().length);
const tq = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571 };
const stats = v => { const m = v.reduce((a, b) => a + b, 0) / v.length, sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)) : 0; return { mean: m, ci95: v.length > 1 ? tq[v.length - 1] * sd / Math.sqrt(v.length) : null, min: Math.min(...v), max: Math.max(...v), n: v.length }; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em40-conv-'));
const run = args => JSON.parse(execFileSync(cli, args.map(String), { encoding: 'utf8', maxBuffer: 64 << 20 }));
const report = { generated: new Date().toISOString(), cpu: os.cpus()[0].model, threads, checkpoints, seeds, variants: variants.map(v => v[0]), games: [] };
for (const [name, cfg0] of games) {
  const game = { name, variants: {} };
  for (const [vname, extra] of variants) {
    const perSeed = [];
    for (const seed of seeds) {
      const spec = path.join(dir, 'spec.json'), st = path.join(dir, 'state'), q = path.join(dir, 'q.json');
      fs.writeFileSync(spec, JSON.stringify(E.MultiwayGame({ ...base, ...cfg0, ...extra, privateSeed: seed }).nativeSpec()));
      fs.writeFileSync(q, JSON.stringify({ method: 'exact', timeLimitMs: 600000, maxVisits: 2000000000 }));
      let deals = 0, wall = 0; const rows = [];
      for (const target of checkpoints) {
        const info = run([spec, target - deals, threads, st + '.next', 512, ...(deals ? [st] : [])]);
        fs.renameSync(st + '.next', st);
        deals = target; wall += info.wallSeconds;
        const g = run(['--gain', spec, st, q]);
        rows.push({ deals: info.trainingDeals, updates: info.iterations, wallSeconds: wall, nashConv: g.nashConv, seatGains: g.seats.map(s => s.gain) });
      }
      perSeed.push(rows);
    }
    game.variants[vname] = checkpoints.map((d, i) => ({ deals: d, nashConv: stats(perSeed.map(r => r[i].nashConv)), wallSeconds: stats(perSeed.map(r => r[i].wallSeconds)), perSeed: perSeed.map(r => r[i].nashConv) }));
    console.log(name, vname, game.variants[vname].map(r => r.deals + ':' + r.nashConv.mean.toFixed(4) + '±' + (r.nashConv.ci95 || 0).toFixed(4) + ' (' + r.wallSeconds.mean.toFixed(2) + ' s)').join('  '));
  }
  // paired comparison against the default at every checkpoint (same seeds)
  game.comparison = {};
  for (const [vname] of variants.slice(1)) game.comparison[vname] = checkpoints.map((d, i) => {
    const diff = game.variants[vname][i].perSeed.map((x, s) => x - game.variants.linear[i].perSeed[s]), st = stats(diff);
    return { deals: d, meanDifference: st.mean, ci95: st.ci95, verdict: st.ci95 != null && st.mean + st.ci95 < 0 ? 'better' : st.ci95 != null && st.mean - st.ci95 > 0 ? 'worse' : 'no supported difference' };
  });
  report.games.push(game);
}
fs.writeFileSync(out, JSON.stringify(report, null, 1));
fs.rmSync(dir, { recursive: true, force: true });
