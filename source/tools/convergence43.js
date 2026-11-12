// EightMax 4.3 (Priority 7): ten-seed convergence study of the default trainer
// against the variance-reduction and weighting options that already exist in
// the native external-sampling engine but have never been validated:
//   linear            default: linear averaging, standard regret matching
//   baseline          terminalBaseline: control variate at opponent decisions
//                     (terminal siblings evaluated exactly, the sampled
//                     non-terminal action carries s_a/q_a (v_a - b); unbiased)
//   expectation       terminalExpectation: exact expectation when both children
//                     of a two-action opponent decision are terminal (unbiased)
//   baseline+expect.  both
//   rm-plus           regret matching+ (regrets floored at zero)
//   dcfr-1-1-2        DCFR(alpha 1, beta 1, gamma 2) (4.2's strongest alternative)
// Quality is measured INDEPENDENTLY of training: exact best response of every
// seat after each checkpoint (mwcli --gain method exact), NashConv = sum of the
// per-seat gains. ICM games are not zero-sum: no exploitability is claimed, and
// NashConv describes THIS abstraction (fixed hands / ranges, bet menus), not
// full eight-handed No-Limit Hold'em.
// Per checkpoint and variant: mean, median, SD, 95% t interval and range over
// seeds; per-seat gains; cumulative training seconds; evaluation seconds; peak
// trainer RSS. Comparisons with the default, paired by seed (Holm over every
// comparison of the report, family-wise 5%):
//   equal samples  NashConv at the same sampled-deal count
//   equal time     log NashConv interpolated (in log time) at the default's
//                  cumulative training time of that checkpoint
// usage: node tools/convergence43.js <mwcli> <out.json> [--seeds=10] [--quick] [--games=a,b]
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process');
const E = require('./loadlib'); for (const l of ['lib_runouts', 'lib_wide', 'lib_river']) require('../web/' + l);
const args = process.argv.slice(2), [cli, out] = args.filter(a => !a.startsWith('--'));
const quick = args.includes('--quick'), opt = k => (args.find(a => a.startsWith('--' + k + '=')) || '').split('=')[1];
const nSeeds = +(opt('seeds') || (quick ? 3 : 10)), onlyGames = opt('games') ? opt('games').split(',') : null;
const base = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128 };
const SEATS8 = ['UTG', 'UTG+1', 'MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
const games = [
  ['push8', 'Eight-player preflop push/fold, fixed hands (ICM)', { preflop: { mode: 'shove' }, board: '', dealt: 8, common: 0, stacks: [30, 22, 15, 40, 9, 18, 25, 12], ranges: ['AsAh', 'KsKh', 'QsQh', 'JsJh', 'TsTh', '9s9h', '8s8h', '7s7h'], icm: { payouts: [30, 20, 14, 11, 9, 7, 5, 4] }, batchDeals: 4, actionStreams: 'deal' },
    [4000, 20000, 50000, 100000, 250000, 500000]],
  ['river3', 'Three-player river, side pots (ICM)', { board: 'Ks8d5h2c2s', common: 6, stacks: [4, 12, 30], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc'], icm: { payouts: [50, 30, 20], others: [10] }, streets: { river: { bets: '75,a', raises: 'a', maxBets: 2 } } },
    [4000, 20000, 50000, 100000, 250000, 500000]],
  ['turn4', 'Four-player turn, unequal stacks, side pots (chip EV), two bet sizes', { board: 'Qh9c4d2s', common: 8, stacks: [6, 14, 25, 40], ranges: ['AhQs,9h9d,KcJc', 'Kh9s,4h4c,JdTd', 'AcAd,Qc8c,7s6s', 'QdJh,5d3d,Ks2h'], streets: { turn: { bets: '50,a', raises: 'a', maxBets: 2 }, river: { bets: '75,a', raises: 'a', maxBets: 1 } } },
    [2000, 10000, 40000, 100000]],
];
const D = (a, b, g) => ({ weighting: 'dcfr', dcfrAlpha: a, dcfrBeta: b, dcfrGamma: g });
const variants = [['linear', {}], ['baseline', { terminalBaseline: true }], ['expectation', { terminalExpectation: true }], ['baseline+expectation', { terminalBaseline: true, terminalExpectation: true }], ['rm-plus', { regretMatching: 'plus' }], ['dcfr-1-1-2', D(1, 1, 2)]];
const seeds = Array.from({ length: nSeeds }, (_, i) => i + 1), threads = Math.min(4, os.cpus().length);
function tq(df) { const t = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 14: 2.145, 19: 2.093, 29: 2.045 }; if (t[df]) return t[df]; const k = Object.keys(t).map(Number).filter(x => x <= df).pop(); return t[k] || 1.96; }
function betacf(a, b, x) { let c = 1, d = 1 - (a + b) * x / (a + 1); d = 1 / d; let h = d; for (let m = 1; m < 200; m++) { const m2 = 2 * m; let aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2)); d = 1 + aa * d; c = 1 + aa / c; d = 1 / d; h *= d * c; aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1)); d = 1 + aa * d; c = 1 + aa / c; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-14) break; } return h; }
function lgamma(z) { const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; let x = z, y = z, t = x + 5.5; t -= (x + 0.5) * Math.log(t); let s = 1.000000000190015; for (const c of g) s += c / ++y; return -t + Math.log(2.5066282746310005 * s / x); }
function ibeta(a, b, x) { if (x <= 0) return 0; if (x >= 1) return 1; const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x)); return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b; }
const tTwoSided = (t, df) => Number.isFinite(t) ? ibeta(df / 2, 0.5, df / (df + t * t)) : 0;
const stats = v => { const n = v.length, m = v.reduce((a, b) => a + b, 0) / n, sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : 0, s = v.slice().sort((a, b) => a - b);
  return { mean: m, median: n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2, sd, ci95: n > 1 ? tq(n - 1) * sd / Math.sqrt(n) : null, min: s[0], max: s[n - 1], n }; };
const paired = (a, b) => { const d = a.map((x, i) => x - b[i]), st = stats(d), se = st.sd / Math.sqrt(d.length), t = se > 0 ? st.mean / se : (st.mean === 0 ? 0 : Infinity); return { meanDifference: st.mean, ci95: st.ci95, t, df: d.length - 1, p: tTwoSided(t, d.length - 1) }; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em43-conv-'));
const run = a => JSON.parse(execFileSync(cli, a.map(String), { encoding: 'utf8', maxBuffer: 64 << 20 }));
const report = { tool: 'convergence43', generated: new Date().toISOString(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, trainingThreads: threads, seeds, variants: variants.map(v => ({ name: v[0], options: v[1] })), games: [],
  method: 'exact best response of every seat after each checkpoint (independent of training); NashConv = sum of per-seat gains; paired per-seed differences at equal sampled deals and at equal training time (log-log interpolation); Student t, Holm-adjusted over all comparisons (family-wise 5%)' };
// log NashConv at time T from one seed's rows (piecewise linear in log time; clamped to the measured range)
function atTime(rows, T) {
  const lt = Math.log(T), pts = rows.map(r => [Math.log(r.wallSeconds), Math.log(Math.max(r.nashConv, 1e-12))]);
  if (lt <= pts[0][0]) return { value: pts[0][1], extrapolated: lt < pts[0][0] };
  for (let i = 1; i < pts.length; i++) if (lt <= pts[i][0]) { const f = (lt - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]); return { value: pts[i - 1][1] + f * (pts[i][1] - pts[i - 1][1]), extrapolated: false }; }
  return { value: pts[pts.length - 1][1], extrapolated: true };
}
for (const [key, name, cfg0, checkpoints] of games) {
  if (onlyGames && !onlyGames.includes(key)) continue;
  const cps = quick ? checkpoints.slice(0, 2) : checkpoints;
  const game = { key, name, checkpoints: cps, variants: {} }, raw = {};
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
      const eqSamples = paired(raw[vname].map(r => r[i].nashConv), raw.linear.map(r => r[i].nashConv));
      // equal time: both at the default's cumulative time of this checkpoint (per seed)
      const T = raw.linear.map(r => r[i].wallSeconds);
      const v = raw[vname].map((r, s) => atTime(r, T[s])), l = raw.linear.map((r, s) => atTime(r, T[s]));
      const eqTime = paired(v.map(x => x.value), l.map(x => x.value));
      eqTime.scale = 'difference of natural-log NashConv (negative = variant lower at equal time)'; eqTime.extrapolatedSeeds = v.filter(x => x.extrapolated).length;
      return { deals: d, equalSamples: eqSamples, equalTime: eqTime };
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
