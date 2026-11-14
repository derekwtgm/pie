// EightMax 4.8 (Priorities 1, 2, 6, 14): ten-seed convergence study of SELECTABLE trainer
// configurations against the validated default on the 4.7 study games plus the 4.8 games
// (four-player turn, five-player flop, weighted six-player flop with two bet sizes).
// Method (as convergence47.js): for each seed, every variant trains the same game from scratch
// to the same sampled-deal checkpoints with the same 512 MiB table budget and ONE training thread;
// after each checkpoint every seat's EXACT unilateral best response is computed (mwcli --gain
// method=exact, independent of training, deterministic). NashConv = sum of seat gains inside the
// abstraction (exploitability = NashConv / 2 only for two-player chip-EV games).
// Comparisons: per-seed paired differences of natural-log NashConv between a variant and the
// default (a) at equal sampled deals and (b) at equal training time (log-log interpolation of
// the variant's curve at the default's cumulative time), Student t, Holm-adjusted over ALL
// comparisons of the run (family-wise 5%). "variant better/worse" only when Holm p < 0.05.
// Seeds are split over --jobs worker processes; each worker rotates the variant order per seed
// so that machine load affects every variant alike (training time is still wall time under that
// load: reported, and comparable only inside one run).
//
// usage: node tools/convergence48.js <mwcli> <out.json> [--seeds=10] [--seed-offset=300]
//        [--games=flop6,flop6w,...] [--variants=default,eps0.05,...] [--jobs=3] [--quick]
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync, spawn } = require('node:child_process');
const G = require('./games48');
const args = process.argv.slice(2), [cliArg, out] = args.filter(a => !a.startsWith('--'));
const opt = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const cli = path.resolve(cliArg);
const VARIANTS = {
  'default': {},
  'eps0': { opponentExploration: 0 },
  'eps0.05': { opponentExploration: 0.05 },
  'eps0.2': { opponentExploration: 0.2 },
  'eps0.4': { opponentExploration: 0.4 },
  'batch8': { batchDeals: 8 },
  'own-hands+baseline': { ownHandEnumeration: true, terminalBaseline: true },
  'rm-plus': { regretMatching: 'plus' },
  'dcfr': { weighting: 'dcfr' },
  // 5.0 candidate: simultaneous 16-deal batches with per-deal action streams, so training can use
  // every --threads worker (the default alternates one deal per update and uses one thread).
  'parallel16': { batchDeals: 16, actionStreams: 'deal' },
  'parallel64': { batchDeals: 64, actionStreams: 'deal' },
};
const quick = args.includes('--quick');
const nSeeds = +opt('seeds', quick ? 3 : 10), seedOffset = +opt('seed-offset', 300);
const keys = (opt('games') || 'hu-river,river3-chip,turn4,bubble4,flop5,flop6,flop6w,final8').split(',');
const vnames = (opt('variants') || 'default,eps0,eps0.05,eps0.2,eps0.4,batch8,own-hands+baseline').split(',');
if (vnames[0] !== 'default') throw new Error('the first variant must be default');
for (const v of vnames) if (!VARIANTS[v]) throw new Error('unknown variant ' + v);
const seeds = Array.from({ length: nSeeds }, (_, i) => seedOffset + 1 + i);
// 5.0: training threads (default 1, as in 4.9) and evaluation threads (exact gains are thread-independent)
const trainThreads = +opt('threads', 1), evalThreads = +opt('eval-threads', 1);
// ---------------- worker: one seed list, raw rows ----------------
if (opt('worker')) {
  const mySeeds = opt('worker').split(',').map(Number), raw = {}; const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em48-conv-'));
  const run = a => JSON.parse(execFileSync(cli, a.map(String), { encoding: 'utf8', maxBuffer: 256 << 20 }));
  for (const key of keys) {
    const cps = quick ? G.byKey[key][3].slice(0, 2) : G.byKey[key][3]; raw[key] = {};
    for (const seed of mySeeds) {
      const order = vnames.map((v, i) => vnames[(i + seed) % vnames.length]);
      for (const vname of order) {
        const sp = G.spec(key, seed, VARIANTS[vname]);
        const spec = path.join(dir, 'spec.json'), st = path.join(dir, 'state'), q = path.join(dir, 'q.json');
        fs.writeFileSync(spec, JSON.stringify(sp));
        fs.writeFileSync(q, JSON.stringify({ method: 'exact', threads: evalThreads, timeLimitMs: 3600000, maxVisits: 2000000000 }));
        let deals = 0, wall = 0, peak = 0; const rows = [];
        for (const target of cps) {
          const updates = Math.round((target - deals) / (sp.batchDeals || 1));
          const info = run([spec, updates, trainThreads, st + '.next', 512, ...(deals ? [st] : [])]);
          fs.renameSync(st + '.next', st);
          deals = info.trainingDeals; wall += info.wallSeconds; peak = Math.max(peak, info.processPeakRssMiB || 0);
          const t0 = process.hrtime.bigint(), g = run(['--gain', spec, st, q]), evalWall = Number(process.hrtime.bigint() - t0) / 1e9;
          rows.push({ deals: info.trainingDeals, updates: info.iterations, rows: info.rows, states: info.states, wallSeconds: wall, evalSeconds: evalWall, peakRssMiB: peak, nashConv: g.nashConv, seatGains: g.seats.map(s => s.gain), policyValues: g.seats.map(s => s.policyValue), fallbackLookups: g.seats.reduce((a, s) => a + (s.fallbackLookups || 0), 0), policyLookups: g.seats.reduce((a, s) => a + (s.policyLookups || 0), 0) });
        }
        (raw[key][vname] ||= {})[seed] = rows;
        process.stderr.write(key + ' ' + vname + ' seed ' + seed + ' NashConv ' + rows.map(r => r.nashConv.toExponential(2)).join(' ') + '\n');
      }
    }
  }
  fs.writeFileSync(opt('raw'), JSON.stringify(raw)); fs.rmSync(dir, { recursive: true, force: true }); process.exit(0);
}
// ---------------- statistics ----------------
function tq(df) { const t = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 14: 2.145, 19: 2.093, 29: 2.045 }; if (t[df]) return t[df]; const k = Object.keys(t).map(Number).filter(x => x <= df).pop(); return t[k] || 1.96; }
function betacf(a, b, x) { let c = 1, d = 1 - (a + b) * x / (a + 1); d = 1 / d; let h = d; for (let m = 1; m < 200; m++) { const m2 = 2 * m; let aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2)); d = 1 + aa * d; c = 1 + aa / c; d = 1 / d; h *= d * c; aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1)); d = 1 + aa * d; c = 1 + aa / c; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-14) break; } return h; }
function lgamma(z) { const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; let x = z, y = z, t = x + 5.5; t -= (x + 0.5) * Math.log(t); let s = 1.000000000190015; for (const c of g) s += c / ++y; return -t + Math.log(2.5066282746310005 * s / x); }
function ibeta(a, b, x) { if (x <= 0) return 0; if (x >= 1) return 1; const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x)); return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b; }
const tTwoSided = (t, df) => Number.isFinite(t) ? ibeta(df / 2, 0.5, df / (df + t * t)) : 0;
const stats = v => { const n = v.length, m = v.reduce((a, b) => a + b, 0) / n, sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : 0, s = v.slice().sort((a, b) => a - b);
  return { mean: m, median: n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2, variance: sd * sd, sd, ci95: n > 1 ? tq(n - 1) * sd / Math.sqrt(n) : null, min: s[0], max: s[n - 1], n }; };
const paired = (a, b) => { const d = a.map((x, i) => x - b[i]), st = stats(d), se = st.sd / Math.sqrt(d.length), t = se > 0 ? st.mean / se : (st.mean === 0 ? 0 : Infinity); return { meanDifference: st.mean, ci95: st.ci95 == null ? null : [st.mean - st.ci95, st.mean + st.ci95], ratio: Math.exp(st.mean), t, df: d.length - 1, p: tTwoSided(t, d.length - 1) }; };
function atTime(rows, T) {
  const lt = Math.log(T), pts = rows.map(r => [Math.log(r.wallSeconds), Math.log(Math.max(r.nashConv, 1e-12))]);
  if (lt <= pts[0][0]) return { value: pts[0][1], extrapolated: lt < pts[0][0] };
  for (let i = 1; i < pts.length; i++) if (lt <= pts[i][0]) { const f = (lt - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]); return { value: pts[i - 1][1] + f * (pts[i][1] - pts[i - 1][1]), extrapolated: false }; }
  return { value: pts[pts.length - 1][1], extrapolated: true };
}
// ---------------- main: spawn workers, aggregate ----------------
(async () => {
  const jobs = Math.max(1, Math.min(+opt('jobs', 3), seeds.length)), parts = Array.from({ length: jobs }, () => []);
  seeds.forEach((s, i) => parts[i % jobs].push(s));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em48-main-')), t0 = Date.now();
  const raws = await Promise.all(parts.map((ps, j) => new Promise((res, rej) => {
    const rawFile = path.join(tmp, 'raw' + j + '.json');
    const p = spawn(process.execPath, [__filename, cli, out, ...args.filter(a => a.startsWith('--') && !a.startsWith('--jobs')), '--worker=' + ps.join(','), '--raw=' + rawFile], { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('exit', c => c ? rej(new Error('worker ' + j + ' exit ' + c)) : res(JSON.parse(fs.readFileSync(rawFile, 'utf8'))));
  })));
  const raw = {}; for (const r of raws) for (const k in r) for (const v in r[k]) Object.assign((raw[k] ||= {})[v] ||= {}, r[k][v]);
  const report = { tool: 'convergence48', generated: new Date().toISOString(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, workers: jobs, trainingThreads: trainThreads, evaluationThreads: evalThreads, tableBudgetMiB: 512, seeds, studyWallSeconds: (Date.now() - t0) / 1000,
    variants: vnames.map(v => ({ name: v, options: VARIANTS[v], validatedDefault: v === 'default' })),
    method: 'exact best response of every seat after each checkpoint (independent of training, deterministic); NashConv = sum of per-seat gains inside the abstraction; paired per-seed differences of ln NashConv at equal sampled deals and at equal training time; Student t; Holm over all comparisons (family-wise 5%)', games: [] };
  for (const key of keys) {
    const g = G.byKey[key], cps = quick ? g[3].slice(0, 2) : g[3];
    const game = { key, description: g[1], players: G.spec(key, 1).n, twoPlayerZeroSum: g[4], metric: g[4] ? 'NashConv; exploitability = NashConv / 2 (exact for this two-player chip-EV abstraction)' : 'NashConv = sum of exact unilateral best-response gains inside this abstraction; NOT exploitability', checkpoints: cps, variants: {}, comparison: {} };
    for (const v of vnames) {
      const per = seeds.map(s => raw[key][v][s]);
      game.variants[v] = cps.map((_, i) => ({ deals: stats(per.map(r => r[i].deals)).mean, nashConv: stats(per.map(r => r[i].nashConv)), trainingSeconds: stats(per.map(r => r[i].wallSeconds)), evalSeconds: stats(per.map(r => r[i].evalSeconds)), rows: stats(per.map(r => r[i].rows)), peakRssMiB: Math.max(...per.map(r => r[i].peakRssMiB)),
        fallbackShare: stats(per.map(r => r[i].policyLookups ? r[i].fallbackLookups / r[i].policyLookups : 0)), perSeed: per.map(r => r[i].nashConv), seats: per[0][i].seatGains.map((_, k) => ({ seat: k, gain: stats(per.map(r => r[i].seatGains[k])) })) }));
      console.log(key.padEnd(12), v.padEnd(20), game.variants[v].map(r => Math.round(r.deals) + ':' + r.nashConv.mean.toExponential(2) + ' (' + r.trainingSeconds.mean.toFixed(2) + 's)').join('  '));
    }
    for (const v of vnames.slice(1)) {
      game.comparison[v] = cps.map((_, i) => {
        const L = x => Math.log(Math.max(x, 1e-300));
        const A = seeds.map(s => raw[key][v][s]), B = seeds.map(s => raw[key].default[s]);
        const eqDeals = paired(A.map(r => L(r[i].nashConv)), B.map(r => L(r[i].nashConv)));
        // 5.0: both curves are evaluated at the EARLIER of the two arms' cumulative training times of this
        // checkpoint (per seed), by log-log interpolation inside each curve. 4.9 evaluated the variant at the
        // default's time, which for a FASTER variant lies beyond its last point and was clamped to it, so the
        // equal-time test silently equalled the equal-deal test.
        const T = A.map((r, s) => Math.min(r[i].wallSeconds, B[s][i].wallSeconds)), va = A.map((r, s) => atTime(r, T[s])), vb = B.map((r, s) => atTime(r, T[s]));
        const eqTime = paired(va.map(x => x.value), vb.map(x => x.value)); eqTime.extrapolatedSeeds = va.filter(x => x.extrapolated).length + vb.filter(x => x.extrapolated).length; eqTime.comparisonSeconds = T;
        return { checkpoint: cps[i], equalDeals: eqDeals, equalTime: eqTime };
      });
    }
    report.games.push(game);
  }
  const all = report.games.flatMap(g => Object.values(g.comparison).flat().flatMap(c => [c.equalDeals, c.equalTime]));
  all.slice().sort((a, b) => a.p - b.p).reduce((run, c, i) => { c.holmP = Math.max(run, Math.min(1, (all.length - i) * c.p)); return c.holmP; }, 0);
  for (const c of all) c.verdict = c.holmP < 0.05 ? (c.meanDifference < 0 ? 'variant better' : 'variant worse') : 'no supported difference';
  report.comparisons = all.length;
  report.summary = {};
  for (const v of vnames.slice(1)) {
    const cs = report.games.flatMap(g => g.comparison[v].map(c => ({ game: g.key, ...c })));
    const count = k => ({ better: cs.filter(c => c[k].verdict === 'variant better').length, worse: cs.filter(c => c[k].verdict === 'variant worse').length, notSupported: cs.filter(c => c[k].verdict === 'no supported difference').length });
    report.summary[v] = { equalDeals: count('equalDeals'), equalTime: count('equalTime'), byGame: Object.fromEntries(report.games.map(g => [g.key, { equalDeals: g.comparison[v].map(c => c.equalDeals.verdict[8] || '.'), equalTime: g.comparison[v].map(c => c.equalTime.verdict[8] || '.'), lastRatioEqualDeals: g.comparison[v].at(-1).equalDeals.ratio, lastRatioEqualTime: g.comparison[v].at(-1).equalTime.ratio }])) };
    console.log(v.padEnd(20), 'equal deals', JSON.stringify(report.summary[v].equalDeals), 'equal time', JSON.stringify(report.summary[v].equalTime));
  }
  report.raw = raw;   // 5.0: every seed's rows (deals, updates, training and evaluation seconds, NashConv, seat gains, peak RSS)
  fs.writeFileSync(out, JSON.stringify(report, null, 1)); fs.rmSync(tmp, { recursive: true, force: true });
  console.log('wrote', out, report.comparisons, 'Holm-adjusted comparisons');
})().catch(e => { console.error(e); process.exit(1); });
