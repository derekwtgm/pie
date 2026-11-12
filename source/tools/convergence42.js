// EightMax 4.2 (Priority 7): convergence of the default trainer measured on
// EIGHT-player games with exact multi-seat best responses (4.2 pattern
// projection makes exact eight-seat NashConv about 20x cheaper than in 4.1),
// plus the 4.1 three-player side-pot ICM game. (An eight-player game with two
// hands per seat needs about 2,000 showdown tables per exact NashConv - about
// five minutes each here - and was left out of the routine study.)
// usage: node tools/convergence42.js <mwcli> <out.json> [--quick]
// Checkpoints: 4,000 / 20,000 / 50,000 / 100,000 / 250,000 / 500,000 sampled
// deals, seeds 1-3, the default (linear averaging) and DCFR(1,1,2), the
// strongest alternative of the 4.1 study. Reported per checkpoint: NashConv
// (sum of exact per-seat gains; ICM games are not zero-sum, so no
// exploitability is claimed), per-seat gains UTG..BB with their spread over
// seeds, and cumulative training seconds (read accuracy at equal time across
// rows). Paired per-seed differences, Holm-adjusted. No training code changed.
// NashConv measures THIS abstraction (fixed hands / ranges and bet menus), not
// full eight-handed No-Limit Hold'em; it is not a proof of convergence.
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process');
const E = require('./loadlib'); for (const l of ['lib_runouts', 'lib_wide', 'lib_river']) require('../web/' + l);
const [cli, out] = process.argv.slice(2), quick = process.argv.includes('--quick');
const base = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128 };
const SEATS8 = ['UTG', 'UTG+1', 'MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
const games = [
  ['Eight-player preflop push/fold, fixed hands (ICM)', { preflop: { mode: 'shove' }, board: '', dealt: 8, common: 0, stacks: [30, 22, 15, 40, 9, 18, 25, 12], ranges: ['AsAh', 'KsKh', 'QsQh', 'JsJh', 'TsTh', '9s9h', '8s8h', '7s7h'], icm: { payouts: [30, 20, 14, 11, 9, 7, 5, 4] }, batchDeals: 4, actionStreams: 'deal' }],
  ['Three-player river, side pots (ICM)', { board: 'Ks8d5h2c2s', common: 6, stacks: [4, 12, 30], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc'], icm: { payouts: [50, 30, 20], others: [10] }, streets: { river: { bets: '75,a', raises: 'a', maxBets: 2 } } }],
];
const D = (a, b, g) => ({ weighting: 'dcfr', dcfrAlpha: a, dcfrBeta: b, dcfrGamma: g });
const variants = [
  ['linear', {}], ['dcfr-1-1-2', D(1, 1, 2)],
];
const checkpoints = quick ? [4000, 20000] : [4000, 20000, 50000, 100000, 250000, 500000];
const seeds = quick ? [1, 2] : [1, 2, 3], threads = Math.min(4, os.cpus().length);
const tq = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571 };
// two-sided Student t p-value (regularized incomplete beta by continued fraction)
function betacf(a, b, x) { let c = 1, d = 1 - (a + b) * x / (a + 1); d = 1 / d; let h = d; for (let m = 1; m < 200; m++) { const m2 = 2 * m; let aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2)); d = 1 + aa * d; c = 1 + aa / c; d = 1 / d; h *= d * c; aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1)); d = 1 + aa * d; c = 1 + aa / c; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-14) break; } return h; }
function lgamma(z) { const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; let x = z, y = z, t = x + 5.5; t -= (x + 0.5) * Math.log(t); let s = 1.000000000190015; for (const c of g) s += c / ++y; return -t + Math.log(2.5066282746310005 * s / x); }
function ibeta(a, b, x) { if (x <= 0) return 0; if (x >= 1) return 1; const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x)); return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b; }
function tTwoSided(t, df) { if (!Number.isFinite(t)) return 0; return ibeta(df / 2, 0.5, df / (df + t * t)); }
const stats = v => { const m = v.reduce((a, b) => a + b, 0) / v.length, sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)) : 0; return { mean: m, ci95: v.length > 1 ? tq[v.length - 1] * sd / Math.sqrt(v.length) : null, min: Math.min(...v), max: Math.max(...v), n: v.length }; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em42-conv-'));
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
        rows.push({ deals: info.trainingDeals, updates: info.iterations, wallSeconds: wall, evalSeconds: g.elapsedMs / 1000, nashConv: g.nashConv, seatGains: g.seats.map(s => s.gain), coverage: g.seats.map(s => [s.distinctInformationSets, s.distinctFallbackInformationSets]) });
      }
      perSeed.push(rows);
    }
    game.variants[vname] = checkpoints.map((d, i) => ({ deals: d, nashConv: stats(perSeed.map(r => r[i].nashConv)), wallSeconds: stats(perSeed.map(r => r[i].wallSeconds)), evalSeconds: stats(perSeed.map(r => r[i].evalSeconds)), perSeed: perSeed.map(r => r[i].nashConv),
      seats: perSeed[0][i].seatGains.map((_, k) => ({ seat: perSeed[0][i].seatGains.length === 8 ? SEATS8[k] : 'seat ' + (k + 1), gain: stats(perSeed.map(r => r[i].seatGains[k])) })) }));
    console.log(name, vname, game.variants[vname].map(r => r.deals + ':' + r.nashConv.mean.toFixed(4) + '±' + (r.nashConv.ci95 || 0).toFixed(4) + ' (' + r.wallSeconds.mean.toFixed(2) + ' s)').join('  '));
  }
  // paired comparison against the default at every checkpoint (same seeds)
  game.comparison = {};
  for (const [vname] of variants.slice(1)) game.comparison[vname] = checkpoints.map((d, i) => {
    const diff = game.variants[vname][i].perSeed.map((x, s) => x - game.variants.linear[i].perSeed[s]), st = stats(diff);
    const sd = st.ci95 != null ? st.ci95 / tq[diff.length - 1] * Math.sqrt(diff.length) : 0, tstat = sd > 0 ? st.mean / (sd / Math.sqrt(diff.length)) : (st.mean === 0 ? 0 : Infinity);
    return { deals: d, meanDifference: st.mean, ci95: st.ci95, t: tstat, df: diff.length - 1, p: tTwoSided(tstat, diff.length - 1), unadjustedVerdict: st.ci95 != null && st.mean + st.ci95 < 0 ? 'better' : st.ci95 != null && st.mean - st.ci95 > 0 ? 'worse' : 'no supported difference' };
  });
  report.games.push(game);
}
// Holm over every comparison in the report (family-wise 5%)
const all = report.games.flatMap(g => Object.values(g.comparison).flat());
all.slice().sort((a, b) => a.p - b.p).reduce((run, c, i) => { c.holmP = Math.max(run, Math.min(1, (all.length - i) * c.p)); return c.holmP; }, 0);
for (const c of all) c.verdict = c.holmP < 0.05 ? (c.meanDifference < 0 ? 'better' : 'worse') : 'no supported difference';
report.comparisons = all.length; report.method = 'exact best response of every seat after each checkpoint (independent of training); paired per-seed differences of exact NashConv; Student t p-values, Holm-adjusted over all comparisons (family-wise 5%)';
fs.writeFileSync(out, JSON.stringify(report, null, 1));
fs.rmSync(dir, { recursive: true, force: true });
