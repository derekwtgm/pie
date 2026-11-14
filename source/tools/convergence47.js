// EightMax 4.7 (Priorities 2, 3, 14): ten-seed engine convergence study of the 4.7
// experimental estimator (own-hand enumeration, alone and with the terminal baseline)
// against the validated default, on the six 4.4-4.6 games with EXACT best responses.
// Derived from tools/convergence46.js (same games, checkpoints, evaluator, statistics and
// reporting; see that file for the method). Changes: variants; seeds 201-210 by default
// (--seed-offset=200; never used by 4.4-4.6); training threads fixed by --threads (default 4);
// per-run peak resident memory recorded (equal 512 MiB table budget for every variant).
// What the numbers mean (unchanged): two-player zero-sum games report exact exploitability
// (NashConv / 2) of the abstraction; every other game reports NashConv = the sum of exact
// unilateral best-response gains inside the abstraction, which is NOT exploitability and
// says nothing about unrestricted eight-player No-Limit Hold'em.
// usage: node tools/convergence47.js <mwcli> <out.json> [--seeds=10] [--quick] [--games=a,b] [--seed-offset=200] [--threads=4]
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process');
const E = require('./loadlib'); for (const l of ['lib_runouts', 'lib_wide', 'lib_river']) require('../web/' + l);
const args = process.argv.slice(2), [cli, out] = args.filter(a => !a.startsWith('--'));
const quick = args.includes('--quick'), opt = k => { const a = args.find(a => a.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : undefined; };
const nSeeds = +(opt('seeds') || (quick ? 3 : 10)), onlyGames = opt('games') ? opt('games').split(',') : null;
const base = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128 };
const SEATS8 = ['UTG', 'UTG+1', 'MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
const games = [
  ['hu-river', 'Heads-up river, chip EV (two-player zero-sum: exploitability = NashConv / 2 is exact for this abstraction)', { board: 'Ks8d5h2c2s', common: 10, stacks: [20, 20], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd'], streets: { river: { bets: '50,a', raises: 'a', maxBets: 2 } } },
    [4000, 20000, 50000, 100000, 250000, 500000, 1000000], true],
  ['hu-turn', 'Heads-up turn and river, chip EV (two-player zero-sum: exact exploitability)', { board: 'Ks8d5h2c', common: 8, stacks: [12, 12], ranges: ['AhKh,KdQd,8s8h,JsTs', 'AsKd,5d5c,8h7h,JdTd'], streets: { turn: { bets: 'a', raises: '', maxBets: 1 }, river: { bets: '50', raises: '', maxBets: 1 } } },
    [4000, 20000, 50000, 100000, 250000, 500000, 1000000], true],
  ['river3-chip', 'Three-player river, unequal stacks, side pots, chip EV', { board: 'Ks8d5h2c2s', common: 6, stacks: [4, 12, 30], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc'], streets: { river: { bets: '75,a', raises: 'a', maxBets: 2 } } },
    [4000, 20000, 50000, 100000, 250000, 500000, 1000000], false],
  ['bubble4', 'Four-player bubble push/fold, weighted two-hand ranges, short stack (ICM: 3 paid)', { preflop: { mode: 'shove' }, dealt: 4, common: 0, board: '', stacks: [12, 7, 20, 4], ranges: ['AsAh,7c2d:0.5', 'KsKh:0.75,8c3d', 'QsQh,6d5d', 'JsJh:0.5,9s8s'], icm: { payouts: [50, 30, 20] }, batchDeals: 4, actionStreams: 'deal' },
    [4000, 20000, 50000, 100000, 250000], false],
  ['flop6', 'Six-player flop, unequal stacks (3 to 50 bb), all-in or fold, two hands a seat, side pots, chip EV', { board: 'Td7c2h', dealt: 8, common: 1.5, stacks: [20, 35, 8, 50, 14, 3], prior: Array(6).fill(2.5), folded: [1, 2.5], ranges: ['AhTh,7s7d', 'KdTs,9c8c', 'QsQd,Ac7h', 'JhTc,6s5s', 'AdKc,2s2d', '8h8d,As2c'], streets: { flop: { bets: 'a', raises: '', maxBets: 1 } } },
    [4000, 20000, 50000, 100000, 250000], false],
  ['final8', 'Eight-player final table push/fold, fixed hands (ICM: 8 paid)', { preflop: { mode: 'shove' }, board: '', dealt: 8, common: 0, stacks: [30, 22, 15, 40, 9, 18, 25, 12], ranges: ['AsAh', 'KsKh', 'QsQh', 'JsJh', 'TsTh', '9s9h', '8s8h', '7s7h'], icm: { payouts: [30, 20, 14, 11, 9, 7, 5, 4] }, batchDeals: 4, actionStreams: 'deal' },
    [4000, 20000, 50000, 100000, 250000], false],
];
const D = (a, b, g) => ({ weighting: 'dcfr', dcfrAlpha: a, dcfrBeta: b, dcfrGamma: g });
const variants = [['linear', {}], ['own-hands', { ownHandEnumeration: true }], ['own-hands+baseline', { ownHandEnumeration: true, terminalBaseline: true }], ['baseline', { terminalBaseline: true }]];
void D;
// --extra='{"name":{...spec options...}}' adds candidate variants; --only-extra compares only those with the default.
if (opt('extra')) { const x = JSON.parse(opt('extra')); if (args.includes('--only-extra')) variants.splice(1); for (const [k, v] of Object.entries(x)) variants.push([k, v]); }
const seedOffset = +(opt('seed-offset') ?? 200), seeds = Array.from({ length: nSeeds }, (_, i) => i + 1 + seedOffset), threads = +(opt('threads') || Math.min(4, os.cpus().length));
function tq(df) { const t = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 14: 2.145, 19: 2.093, 29: 2.045 }; if (t[df]) return t[df]; const k = Object.keys(t).map(Number).filter(x => x <= df).pop(); return t[k] || 1.96; }
function betacf(a, b, x) { let c = 1, d = 1 - (a + b) * x / (a + 1); d = 1 / d; let h = d; for (let m = 1; m < 200; m++) { const m2 = 2 * m; let aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2)); d = 1 + aa * d; c = 1 + aa / c; d = 1 / d; h *= d * c; aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1)); d = 1 + aa * d; c = 1 + aa / c; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-14) break; } return h; }
function lgamma(z) { const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; let x = z, y = z, t = x + 5.5; t -= (x + 0.5) * Math.log(t); let s = 1.000000000190015; for (const c of g) s += c / ++y; return -t + Math.log(2.5066282746310005 * s / x); }
function ibeta(a, b, x) { if (x <= 0) return 0; if (x >= 1) return 1; const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x)); return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b; }
const tTwoSided = (t, df) => Number.isFinite(t) ? ibeta(df / 2, 0.5, df / (df + t * t)) : 0;
const stats = v => { const n = v.length, m = v.reduce((a, b) => a + b, 0) / n, sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : 0, s = v.slice().sort((a, b) => a - b);
  return { mean: m, median: n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2, sd, ci95: n > 1 ? tq(n - 1) * sd / Math.sqrt(n) : null, min: s[0], max: s[n - 1], n }; };
const paired = (a, b) => { const d = a.map((x, i) => x - b[i]), st = stats(d), se = st.sd / Math.sqrt(d.length), t = se > 0 ? st.mean / se : (st.mean === 0 ? 0 : Infinity); return { meanDifference: st.mean, ci95: st.ci95, t, df: d.length - 1, p: tTwoSided(t, d.length - 1) }; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em47-conv-'));
const run = a => JSON.parse(execFileSync(cli, a.map(String), { encoding: 'utf8', maxBuffer: 64 << 20 }));
const report = { tool: 'convergence47', seedOffset, generated: new Date().toISOString(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, trainingThreads: threads, seeds, variants: variants.map(v => ({ name: v[0], options: v[1] })), games: [],
  method: 'exact best response of every seat after each checkpoint (independent of training); NashConv = sum of per-seat gains; paired per-seed differences at equal sampled deals and at equal training time (log-log interpolation); Student t, Holm-adjusted over all comparisons (family-wise 5%)' };
// log NashConv at time T from one seed's rows (piecewise linear in log time; clamped to the measured range)
function atTime(rows, T) {
  const lt = Math.log(T), pts = rows.map(r => [Math.log(r.wallSeconds), Math.log(Math.max(r.nashConv, 1e-12))]);
  if (lt <= pts[0][0]) return { value: pts[0][1], extrapolated: lt < pts[0][0] };
  for (let i = 1; i < pts.length; i++) if (lt <= pts[i][0]) { const f = (lt - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]); return { value: pts[i - 1][1] + f * (pts[i][1] - pts[i - 1][1]), extrapolated: false }; }
  return { value: pts[pts.length - 1][1], extrapolated: true };
}
for (const [key, name, cfg0, checkpoints, zeroSum] of games) {
  if (onlyGames && !onlyGames.includes(key)) continue;
  const cps = quick ? checkpoints.slice(0, 2) : checkpoints;
  const game = { key, name, checkpoints: cps, twoPlayerZeroSum: !!zeroSum, metric: zeroSum ? 'NashConv = sum of the two exact best-response gains; exploitability = NashConv / 2 (exact for this two-player zero-sum abstraction)' : 'NashConv = sum of exact per-seat unilateral best-response gains within this abstraction; NOT exploitability (more than two players and/or ICM utilities)', variants: {} }, raw = {};
  for (const [vname, extra] of variants) {
    const perSeed = [];
    for (const seed of seeds) {
      const spec = path.join(dir, 'spec.json'), st = path.join(dir, 'state'), q = path.join(dir, 'q.json');
      fs.writeFileSync(spec, JSON.stringify(E.MultiwayGame({ ...base, ...cfg0, ...extra, privateSeed: seed }).nativeSpec()));
      fs.writeFileSync(q, JSON.stringify({ method: 'exact', timeLimitMs: 3600000, maxVisits: 2000000000 }));
      let deals = 0, wall = 0, peak = 0; const rows = [];
      for (const target of cps) {
        const info = run([spec, target - deals, threads, st + '.next', 512, ...(deals ? [st] : [])]);
        fs.renameSync(st + '.next', st);
        deals = target; wall += info.wallSeconds; peak = Math.max(peak, info.processPeakRssMiB || 0);
        const t0 = process.hrtime.bigint(), g = run(['--gain', spec, st, q]), evalWall = Number(process.hrtime.bigint() - t0) / 1e9;
        rows.push({ deals: target, trainingDeals: info.trainingDeals, updates: info.iterations, wallSeconds: wall, evalSeconds: evalWall, peakRssMiB: peak, nashConv: g.nashConv, seatGains: g.seats.map(s => s.gain) });
      }
      perSeed.push(rows);
    }
    raw[vname] = perSeed;
    const n = cps.length;
    game.variants[vname] = cps.map((d, i) => ({ deals: d, nashConv: stats(perSeed.map(r => r[i].nashConv)), trainingSeconds: stats(perSeed.map(r => r[i].wallSeconds)), evalSeconds: stats(perSeed.map(r => r[i].evalSeconds)), peakRssMiB: Math.max(...perSeed.map(r => r[i].peakRssMiB)),
      perSeed: perSeed.map(r => r[i].nashConv), seats: perSeed[0][i].seatGains.map((_, k) => ({ seat: perSeed[0][i].seatGains.length === 8 ? SEATS8[k] : 'seat ' + (k + 1), gain: stats(perSeed.map(r => r[i].seatGains[k])) })) }));
    console.log(key, vname.padEnd(22), game.variants[vname].map(r => r.deals + ':' + r.nashConv.mean.toExponential(2) + '±' + (r.nashConv.ci95 || 0).toExponential(1) + ' (' + r.trainingSeconds.mean.toFixed(2) + ' s)').join('  '));
    void n;
  }
  game.comparison = {};
  for (const [vname] of variants.slice(1)) {
    game.comparison[vname] = cps.map((d, i) => {
      const L = x => Math.log(Math.max(x, 1e-300));
      const eqSamples = paired(raw[vname].map(r => L(r[i].nashConv)), raw.linear.map(r => L(r[i].nashConv)));
      eqSamples.scale = 'difference of natural-log NashConv (negative = variant lower at equal sampled deals)';
      const eqSamplesRaw = paired(raw[vname].map(r => r[i].nashConv), raw.linear.map(r => r[i].nashConv));
      // equal time: both at the default's cumulative time of this checkpoint (per seed)
      const T = raw.linear.map(r => r[i].wallSeconds);
      const v = raw[vname].map((r, s) => atTime(r, T[s])), l = raw.linear.map((r, s) => atTime(r, T[s]));
      const eqTime = paired(v.map(x => x.value), l.map(x => x.value));
      eqTime.scale = 'difference of natural-log NashConv (negative = variant lower at equal time)'; eqTime.extrapolatedSeeds = v.filter(x => x.extrapolated).length;
      return { deals: d, equalSamples: eqSamples, equalTime: eqTime, equalSamplesRaw: eqSamplesRaw };
    });
  }
  report.games.push(game);
}
const all = report.games.flatMap(g => Object.values(g.comparison).flat().flatMap(c => [c.equalSamples, c.equalTime]));
all.slice().sort((a, b) => a.p - b.p).reduce((run, c, i) => { c.holmP = Math.max(run, Math.min(1, (all.length - i) * c.p)); return c.holmP; }, 0);
for (const c of all) c.verdict = c.holmP < 0.05 ? (c.meanDifference < 0 ? 'variant better' : 'variant worse') : 'no supported difference';
report.comparisons = all.length;
report.summary = report.games.map(g => ({ game: g.key, variants: Object.fromEntries(Object.entries(g.comparison).map(([v, rows]) => [v, { equalSamples: rows.map(r => r.equalSamples.verdict), equalTime: rows.map(r => r.equalTime.verdict) }])) }));
fs.writeFileSync(out, JSON.stringify(report, null, 1));
fs.rmSync(dir, { recursive: true, force: true });
console.log('wrote', out, report.comparisons, 'comparisons');
