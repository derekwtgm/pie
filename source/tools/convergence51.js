// EightMax 5.1: six-player quality per second (Requirement 1).
// Arms are trainer configurations (5.0 default, fixed parallel64, batch-size warm-up schedules, fixed
// batch sizes for diagnosis). For each seed every arm trains the same game from scratch through a grid
// of sampled-deal checkpoints with the same 512 MiB table budget and the same --threads; after each
// checkpoint the SAME independent evaluator (mwcli --gain method=exact, deterministic, separate process)
// computes every seat's exact unilateral best-response gain inside the abstraction; NashConv = their sum
// (NOT exploitability for multiway games).
// Comparisons with the 5.0 default, per seed, paired:
//   equal wall time   - at each predefined training-time budget T, ln NashConv is interpolated (log-log)
//                       inside each arm's OBSERVED time range; a seed whose curves do not both span T is
//                       EXCLUDED for that budget (never clamped to an endpoint); counts are reported.
//   equal deals       - at each checkpoint deal count, interpolated in log deals inside observed ranges.
// Paired mean of ln ratios, 95% t interval; Holm over the PRIMARY comparisons named in --primary.
// usage: node tools/convergence51.js <mwcli> <out.json> --arms=default,parallel64,warm-4-256 --games=flop6,flop6w,river3-chip,turn4
//        --seeds=10 --seed-offset=600 [--threads=4] [--eval-threads=4] [--budgets=flop6:0.03,0.1,0.3,1;...] [--primary=flop6w@1,...] [--jobs=1]
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync, spawn } = require('node:child_process');
const G = require('./games48');
const args = process.argv.slice(2), [cliArg, out] = args.filter(a => !a.startsWith('--'));
const opt = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const cli = path.resolve(cliArg);
// arm name -> spec options. "warm-S-U": batchSchedule start S, doubling every U committed updates, up to 64.
const fixed = { 'default': {}, 'parallel64': { batchDeals: 64, actionStreams: 'deal' }, 'parallel64-1thread': { batchDeals: 64, actionStreams: 'deal', threads: 1 } };
for (const b of [2, 4, 8, 16, 32]) fixed['batch' + b] = { batchDeals: b, actionStreams: 'deal' };
const armOptions = name => { if (fixed[name]) return fixed[name]; const m = /^warm-(\d+)-(\d+)$/.exec(name); if (m) return { batchDeals: 64, actionStreams: 'deal', batchSchedule: { start: +m[1], doubleEvery: +m[2] } }; throw new Error('unknown arm ' + name); };
// committed deals after t updates (the engine's MW::dealsBefore)
const dealsBefore = (o, t) => { const B = o.batchDeals || 1; if (!o.batchSchedule) return t * B; let d = 0, b = o.batchSchedule.start, done = 0; while (done < t) { const cur = Math.min(b, B), span = b >= B ? t - done : Math.min(t - done, o.batchSchedule.doubleEvery); d += span * cur; done += span; b *= 2; } return d; };
const updatesFor = (o, deals) => { let lo = 0, hi = deals; while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (dealsBefore(o, mid) >= deals) hi = mid; else lo = mid + 1; } return lo; };
const arms = (opt('arms') || 'default,parallel64').split(','); if (arms[0] !== 'default') throw new Error('the first arm must be default');
const keys = (opt('games') || 'flop6,flop6w,river3-chip,turn4').split(',');
const nSeeds = +opt('seeds', 10), seedOffset = +opt('seed-offset', 600), seeds = Array.from({ length: nSeeds }, (_, i) => seedOffset + 1 + i);
const trainThreads = +opt('threads', 4), evalThreads = +opt('eval-threads', 4);
const GRID = { 'flop6': [2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000, 384000], 'flop6w': [2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000, 384000], 'river3-chip': [2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000, 512000], 'turn4': [2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000], 'hu-river': [2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000, 512000], 'bubble4': [4000, 8000, 16000, 32000, 64000, 128000, 256000] };
const grid = key => (opt('grid-' + key) ? opt('grid-' + key).split(',').map(Number) : GRID[key]);
const budgets = Object.fromEntries((opt('budgets') || '').split(';').filter(Boolean).map(x => { const [k, v] = x.split(':'); return [k, v.split(',').map(Number)]; }));
// ---------------- worker ----------------
if (opt('worker')) {
  const mySeeds = opt('worker').split(',').map(Number), raw = {}; const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em51-conv-'));
  const run = a => JSON.parse(execFileSync(cli, a.map(String), { encoding: 'utf8', maxBuffer: 256 << 20 }));
  for (const key of keys) {
    raw[key] = {};
    for (const seed of mySeeds) {
      const order = arms.map((v, i) => arms[(i + seed) % arms.length]);   // rotate the order per seed (machine drift affects every arm alike)
      for (const arm of order) {
        const o = armOptions(arm), { threads, batchSchedule, ...specOptions } = o, sp = G.spec(key, seed, specOptions);
        if (batchSchedule) sp.batchSchedule = batchSchedule;   // 5.1 experimental option (native engine only; the interface does not set it)
        const spec = path.join(dir, 'spec.json'), st = path.join(dir, 'state'), q = path.join(dir, 'q.json');
        fs.writeFileSync(spec, JSON.stringify(sp));
        fs.writeFileSync(q, JSON.stringify({ method: 'exact', threads: evalThreads, timeLimitMs: 3600000, maxVisits: 2000000000 }));
        let updates = 0, wall = 0, peak = 0; const rows = [];
        for (const target of grid(key)) {
          const want = updatesFor(sp, target) - updates; if (want <= 0) continue;
          const info = run([spec, want, threads || trainThreads, st + '.next', 512, ...(updates ? [st] : [])]);
          fs.renameSync(st + '.next', st);
          updates = info.iterations; wall += info.wallSeconds; peak = Math.max(peak, info.processPeakRssMiB || 0);
          if (info.trainingDeals !== dealsBefore(sp, updates)) throw new Error('deal count mismatch');
          const t0 = process.hrtime.bigint(), g = run(['--gain', spec, st, q]), evalWall = Number(process.hrtime.bigint() - t0) / 1e9;
          rows.push({ deals: info.trainingDeals, updates: info.iterations, threads: info.threads, rows: info.rows, wallSeconds: wall, evalSeconds: evalWall, peakRssMiB: peak, evalPeakRssMiB: g.processPeakRssMiB || null, nashConv: g.nashConv, seatGains: g.seats.map(s => s.gain), seconds: info.seconds });
        }
        (raw[key][arm] ||= {})[seed] = rows;
        process.stderr.write(key + ' ' + arm + ' seed ' + seed + ' NashConv ' + rows.map(r => r.nashConv.toExponential(2)).join(' ') + ' | ' + wall.toFixed(2) + ' s\n');
      }
    }
  }
  fs.writeFileSync(opt('raw'), JSON.stringify(raw)); fs.rmSync(dir, { recursive: true, force: true }); process.exit(0);
}
// ---------------- statistics ----------------
function tq(df) { const t = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131, 16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 24: 2.064, 29: 2.045, 34: 2.032, 39: 2.023, 49: 2.010, 59: 2.001 }; if (t[df]) return t[df]; const k = Object.keys(t).map(Number).filter(x => x <= df).pop(); return t[k] || 1.96; }
function betacf(a, b, x) { let c = 1, d = 1 - (a + b) * x / (a + 1); d = 1 / d; let h = d; for (let m = 1; m < 200; m++) { const m2 = 2 * m; let aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2)); d = 1 + aa * d; c = 1 + aa / c; d = 1 / d; h *= d * c; aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1)); d = 1 + aa * d; c = 1 + aa / c; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-14) break; } return h; }
function lgamma(z) { const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; let x = z, y = z, t = x + 5.5; t -= (x + 0.5) * Math.log(t); let s = 1.000000000190015; for (const c of g) s += c / ++y; return -t + Math.log(2.5066282746310005 * s / x); }
function ibeta(a, b, x) { if (x <= 0) return 0; if (x >= 1) return 1; const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x)); return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b; }
const tTwoSided = (t, df) => Number.isFinite(t) ? ibeta(df / 2, 0.5, df / (df + t * t)) : 0;
const stats = v => { const n = v.length; if (!n) return { n: 0 }; const m = v.reduce((a, b) => a + b, 0) / n, sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : 0, s = v.slice().sort((a, b) => a - b);
  return { mean: m, median: n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2, sd, ci95: n > 1 ? tq(n - 1) * sd / Math.sqrt(n) : null, min: s[0], max: s[n - 1], n }; };
const paired = d => { if (d.length < 2) return { n: d.length }; const st = stats(d), se = st.sd / Math.sqrt(d.length), t = se > 0 ? st.mean / se : (st.mean === 0 ? 0 : Infinity);
  return { n: d.length, meanLnRatio: st.mean, sdLnRatio: st.sd, ratio: Math.exp(st.mean), ratioCi95: [Math.exp(st.mean - st.ci95), Math.exp(st.mean + st.ci95)], t, df: d.length - 1, p: tTwoSided(t, d.length - 1) }; };
// ln NashConv at x (wall seconds or deals) by log-log interpolation; null outside the observed range
const at = (rows, x, k) => { const pts = rows.map(r => [Math.log(r[k]), Math.log(Math.max(r.nashConv, 1e-12))]), lx = Math.log(x);
  if (lx < pts[0][0] - 1e-12 || lx > pts[pts.length - 1][0] + 1e-12) return null;
  for (let i = 1; i < pts.length; i++) if (lx <= pts[i][0] + 1e-12) { const f = pts[i][0] === pts[i - 1][0] ? 1 : (lx - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]); return pts[i - 1][1] + Math.min(1, Math.max(0, f)) * (pts[i][1] - pts[i - 1][1]); }
  return pts[0][1]; };
(async () => {
  const jobs = Math.max(1, Math.min(+opt('jobs', 1), seeds.length)), parts = Array.from({ length: jobs }, () => []);
  seeds.forEach((s, i) => parts[i % jobs].push(s));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em51-main-')), t0 = Date.now();
  let raw = {};
  if (opt('reuse-raw')) raw = JSON.parse(fs.readFileSync(opt('reuse-raw'), 'utf8')).raw;
  else {
    const raws = await Promise.all(parts.map((ps, j) => new Promise((res, rej) => {
      const rawFile = path.join(tmp, 'raw' + j + '.json');
      const p = spawn(process.execPath, [__filename, cli, out, ...args.filter(a => a.startsWith('--') && !a.startsWith('--jobs')), '--worker=' + ps.join(','), '--raw=' + rawFile], { stdio: ['ignore', 'inherit', 'inherit'] });
      p.on('exit', c => c ? rej(new Error('worker ' + j + ' exit ' + c)) : res(JSON.parse(fs.readFileSync(rawFile, 'utf8'))));
    })));
    for (const r of raws) for (const k in r) for (const v in r[k]) Object.assign((raw[k] ||= {})[v] ||= {}, r[k][v]);
  }
  const primary = (opt('primary') || '').split(',').filter(Boolean).map(x => { const [g, rest] = x.split('@'); return { game: g, budget: +rest }; });
  const report = { tool: 'convergence51', generated: new Date().toISOString(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, mwcli: cli, build: execFileSync(cli, ['--build-id'], { encoding: 'utf8' }).trim(), workers: jobs, trainingThreads: trainThreads, evaluationThreads: evalThreads, tableBudgetMiB: 512, seeds, studyWallSeconds: (Date.now() - t0) / 1000,
    arms: arms.map(a => ({ name: a, options: armOptions(a) })), budgets, primary,
    method: 'Same independent evaluator for every arm: exact best response of every seat after each checkpoint (mwcli --gain method=exact, separate process, deterministic). NashConv = sum of per-seat gains inside each abstraction (not exploitability). Paired per-seed ln(NashConv arm / NashConv default) at predefined training-time budgets and at checkpoint deal counts, log-log interpolation inside each arm\'s observed range; seeds outside either range are excluded (counted), never clamped. 95% t intervals; Holm over the primary comparisons.', games: [] };
  const allPrimary = [];
  for (const key of keys) {
    const g = G.byKey[key], game = { key, description: g[1], players: G.spec(key, 1).n, metric: 'NashConv = sum of exact unilateral best-response gains inside this abstraction; NOT exploitability', grid: grid(key), budgets: budgets[key] || [], arms: {}, equalTime: {}, equalDeals: {} };
    for (const a of arms) {
      const per = seeds.map(s => raw[key][a][s]), n = per[0].length;
      game.arms[a] = Array.from({ length: n }, (_, i) => ({ deals: stats(per.map(r => r[i].deals)).mean, updates: stats(per.map(r => r[i].updates)).mean, nashConv: stats(per.map(r => r[i].nashConv)), trainingSeconds: stats(per.map(r => r[i].wallSeconds)), evalSeconds: stats(per.map(r => r[i].evalSeconds)), peakRssMiB: Math.max(...per.map(r => r[i].peakRssMiB)), threadsUsed: Math.max(...per.map(r => r[i].threads || 1)),
        seats: per[0][i].seatGains.map((_, k) => ({ seat: k, gain: stats(per.map(r => r[i].seatGains[k])) })) }));
      console.log(key.padEnd(12), a.padEnd(18), game.arms[a].map(r => Math.round(r.deals / 1000) + 'k:' + r.nashConv.mean.toExponential(2) + '(' + r.trainingSeconds.mean.toFixed(2) + 's)').join(' '));
    }
    for (const a of arms.slice(1)) {
      game.equalTime[a] = (budgets[key] || []).map(T => { const d = [], excluded = []; for (const s of seeds) { const x = at(raw[key][a][s], T, 'wallSeconds'), y = at(raw[key].default[s], T, 'wallSeconds'); if (x == null || y == null) excluded.push(s); else d.push(x - y); } const c = { budgetSeconds: T, ...paired(d), excludedSeeds: excluded.length }; if (primary.some(p => p.game === key && p.budget === T)) { c.primary = true; allPrimary.push(c); } return c; });
      // deal counts: an arm whose batches overshoot a checkpoint by < 2% (one batch) is read at its first point
      const atDeals = (rows, D) => at(rows, D, 'deals') ?? (rows[0].deals >= D && rows[0].deals <= D * 1.02 ? Math.log(Math.max(rows[0].nashConv, 1e-12)) : null);
      game.equalDeals[a] = grid(key).map(D => { const d = [], excluded = []; for (const s of seeds) { const x = atDeals(raw[key][a][s], D), y = atDeals(raw[key].default[s], D); if (x == null || y == null) excluded.push(s); else d.push(x - y); } return { deals: D, ...paired(d), excludedSeeds: excluded.length }; });
      console.log('  ' + a.padEnd(18), 'equal time', game.equalTime[a].map(c => c.budgetSeconds + 's:' + (c.ratio ? c.ratio.toFixed(2) + '[' + c.ratioCi95.map(v => v.toFixed(2)).join(',') + ']n' + c.n : 'excluded')).join(' '), '| equal deals', game.equalDeals[a].map(c => (c.ratio ? c.ratio.toFixed(2) : '-')).join(' '));
    }
    report.games.push(game);
  }
  // Holm over the primary comparisons, per arm
  for (const a of arms.slice(1)) {
    const cs = report.games.flatMap(g => (g.equalTime[a] || []).filter(c => c.primary));
    cs.slice().sort((x, y) => x.p - y.p).reduce((run, c, i) => { c.holmP = Math.max(run, Math.min(1, (cs.length - i) * c.p)); return c.holmP; }, 0);
  }
  report.raw = raw;
  fs.writeFileSync(out, JSON.stringify(report, null, 1)); fs.rmSync(tmp, { recursive: true, force: true });
  console.log('wrote', out);
})().catch(e => { console.error(e); process.exit(1); });
