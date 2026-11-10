// EightMax 3.9: strategy quality against sampled deals and wall time.
// usage: node tools/convergence39.js <mwcli-3.8> <mwcli-3.9> <out.json> [--quick]
// For each game and seed (privateSeed 1..3) both engines train to the
// checkpoints 4,000 / 20,000 / 50,000 / 100,000 / 250,000 / 500,000 sampled
// deals (each segment resumes from the previous checkpoint; deterministic
// continuation makes this identical to an uninterrupted run, see v38/v39 tests).
// At every checkpoint the 3.8 and 3.9 states are compared byte for byte and the
// 3.9 evaluator measures the strategy:
//   exact games    - exact best-response gain of every seat inside the card and
//                    betting abstraction; for heads-up chip EV also the exact
//                    exploitability (NashConv / 2);
//   eight-handed   - sampled one-shot response gain per seat (independent
//                    selection and evaluation streams; lower bound, with SE).
// Wall time is the cumulative training time of each engine, so accuracy at
// equal elapsed time can be read from the same table.
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), { execFileSync } = require('node:child_process');
const E = require('./loadlib'); for (const l of ['lib_runouts', 'lib_wide', 'lib_river']) require('../web/' + l);
const [cli38, cli39, out] = process.argv.slice(2), quick = process.argv.includes('--quick');
const base = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128 };
const games = [
  ['Heads-up river (chip EV)', { board: 'Qs9h4d2c7s', common: 10, stacks: [40, 40], ranges: ['AsQd,KhQh,9s9c,JhTh,8d7d,AhKd,Ts8s,AcAd,5h5d', 'QcJc,TdTc,As4s,KdJd,6s5s,9d8d,7c7d,AhJh,Kc2s'], streets: { river: { bets: '50,a', raises: '2.5x', maxBets: 2 } } }, 'exact'],
  ['Heads-up turn (chip EV)', { board: 'Qs9h4d2c', common: 10, stacks: [40, 40], ranges: ['AsQd,KhQh,9s9c,JhTh,8d7d,AhKd', 'QcJc,TdTc,As4s,KdJd,6s5s,9d8d'], streets: { turn: { bets: '60', raises: '', maxBets: 1 }, river: { bets: '75,a', raises: '', maxBets: 1 } } }, 'exact'],
  ['Three-player river (chip EV)', { board: 'Ks8d5h2c2s', common: 12, stacks: [30, 30, 30], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc,QhJh,9c9d', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd,6h6d,4c3c', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc,6s5s,AdJd'], streets: { river: { bets: '50,125', raises: '2.5x', maxBets: 2 } } }, 'exact'],
  ['Three-player river, side pots (ICM)', { board: 'Ks8d5h2c2s', common: 6, stacks: [4, 12, 30], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc'], icm: { payouts: [50, 30, 20], others: [10] }, streets: { river: { bets: '75,a', raises: 'a', maxBets: 2 } } }, 'exact'],
  ['Eight-player final-table ICM (sampled)', { preflop: { mode: 'linked', opens: '2.2,a', raises: 'a', maxBets: 2 }, board: '', dealt: 8, common: 0, stacks: [30, 22, 15, 40, 9, 18, 25, 12], ranges: Array(8).fill('random'), icm: { payouts: [30, 20, 14, 11, 9, 7, 5, 4] }, streets: { flop: { bets: '50', raises: '', maxBets: 1 }, turn: { bets: 'a', raises: '', maxBets: 1 }, river: { bets: 'a', raises: '', maxBets: 1 } }, batchDeals: 16, actionStreams: 'deal' }, 'sampled'],
];
const checkpoints = quick ? [4000, 20000] : [4000, 20000, 50000, 100000, 250000, 500000];
const seeds = [1, 2, 3], threads = Math.min(4, os.cpus().length);
const tq = { 2: 12.706, 3: 4.303 };
const stats = v => { const m = v.reduce((a, b) => a + b, 0) / v.length, sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)) : 0; return { mean: m, ci95: v.length > 1 ? tq[v.length] * sd / Math.sqrt(v.length) : null, min: Math.min(...v), max: Math.max(...v), n: v.length }; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em39-conv-'));
const body = b => crypto.createHash('sha256').update(b.subarray(12 + b.readUInt32LE(8))).digest('hex');
const run = (cli, args) => JSON.parse(execFileSync(cli, args.map(String), { encoding: 'utf8', maxBuffer: 64 << 20 }));
const report = { generated: new Date().toISOString(), cpu: os.cpus()[0].model, threads, checkpoints, seeds, games: [] };
for (const [name, cfg0, kind] of games) {
  // the eight-handed study is far slower: stop at 50,000 deals (100,000 without --quick is impractical here)
  const marks = kind === 'sampled' ? checkpoints.filter(d => d <= (quick ? 4000 : 50000)) : checkpoints;
  const perSeed = [];
  for (const seed of seeds) {
    const cfg = { ...base, ...cfg0, privateSeed: seed }, spec = path.join(dir, 'spec-' + seed + '.json');
    fs.writeFileSync(spec, JSON.stringify(E.MultiwayGame(cfg).nativeSpec()));
    const batch = cfg0.batchDeals || 1, prev = {}, wall = { '3.8': 0, '3.9': 0 }, points = [];
    for (const deals of marks) {
      const it = deals / batch, done = (points.length ? marks[points.length - 1] : 0) / batch, step = it - done, sha = {};
      for (const [label, cli] of [['3.8', cli38], ['3.9', cli39]]) {
        const state = path.join(dir, label + '-' + seed + '-' + deals + '.state');
        const args = [spec, step, threads, state, 2048]; if (prev[label]) args.push(prev[label]);
        const info = run(cli, args); wall[label] += info.wallSeconds; prev[label] = state; sha[label] = body(fs.readFileSync(state));
        if (info.trainingDeals !== deals) throw Error(name + ': expected ' + deals + ' deals, got ' + info.trainingDeals);
      }
      const req = path.join(dir, 'q.json'); let q;
      if (kind === 'exact') { fs.writeFileSync(req, JSON.stringify({ method: 'exact', maxVisits: 2000000000 })); const g = run(cli39, ['--gain', spec, prev['3.9'], req]); q = { seatGains: g.seats.map(s => s.gain), maxSeatGain: Math.max(...g.seats.map(s => s.gain)), nashConv: g.nashConv, exploitability: g.exploitability }; }
      else { fs.writeFileSync(req, JSON.stringify({ method: 'sampled', samples: quick ? 200 : 1500, selectionSamples: quick ? 16 : 48, reachSamples: quick ? 500 : 4000, seed: 1000 + seed, futureActions: 'sample', timeLimitMs: 900000 })); const g = run(cli39, ['--gain', spec, prev['3.9'], req]); q = { seatGains: g.seats.map(s => s.available ? s.gain.mean : null), seatStdErr: g.seats.map(s => s.available ? s.gain.stdErr : null), maxSeatGain: g.summary.maxSeatGain }; }
      points.push({ deals, wall38: wall['3.8'], wall39: wall['3.9'], identical: sha['3.8'] === sha['3.9'], ...q });
      console.log(name.padEnd(40), 'seed', seed, String(deals).padStart(7), 'deals', 'max seat gain', q.maxSeatGain.toFixed(5), q.exploitability != null ? 'exploitability ' + q.exploitability.toFixed(5) : '', 'wall 3.8', wall['3.8'].toFixed(2), '3.9', wall['3.9'].toFixed(2), sha['3.8'] === sha['3.9'] ? 'identical' : 'DIFFERENT');
      for (const label of ['3.8', '3.9']) { const older = path.join(dir, label + '-' + seed + '-' + (points.length > 1 ? marks[points.length - 2] : 0) + '.state'); if (fs.existsSync(older)) fs.rmSync(older); }
    }
    perSeed.push({ seed, points });
  }
  const table = marks.map((deals, i) => {
    const pts = perSeed.map(s => s.points[i]);
    return { deals, maxSeatGain: stats(pts.map(p => p.maxSeatGain)), exploitability: pts[0].exploitability != null ? stats(pts.map(p => p.exploitability)) : null,
      seatGainMeans: pts[0].seatGains.map((_, j) => stats(pts.map(p => p.seatGains[j]).filter(v => v != null)).mean), wall38: stats(pts.map(p => p.wall38)), wall39: stats(pts.map(p => p.wall39)), allIdentical: pts.every(p => p.identical) };
  });
  report.games.push({ name, measurement: kind === 'exact' ? 'exact best-response gain per seat (card and betting abstraction of the study)' : 'sampled one-shot response gain per seat (lower bound; not exploitability)', utility: cfg0.icm ? 'ICM payout units' : 'BB', perSeed, table });
}
fs.writeFileSync(out, JSON.stringify(report, null, 1));
fs.rmSync(dir, { recursive: true, force: true });
