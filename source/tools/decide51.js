// EightMax 5.1: apply the frozen rule in validation/5.1/six-player/preregistration.json to a convergence51 report;
// add secondary comparisons (warm vs parallel64 at equal time, per-seat gains, resources). No new measurements.
// usage: node tools/decide51.js <confirmation.json> <out.json>
'use strict';
const fs = require('node:fs'), [inp, out] = process.argv.slice(2), R = JSON.parse(fs.readFileSync(inp, 'utf8'));
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
const C = 'warm-4-256', margin = 1.15, minRatio = 0.80, seeds = Object.keys(R.raw.flop6.default).map(Number);
const G = k => R.games.find(g => g.key === k), cmp = (k, T) => G(k).equalTime[C].find(c => c.budgetSeconds === T);
const vs = (k, a, b, T) => { const d = [], ex = []; for (const s of seeds) { const x = at(R.raw[k][a][s], T, 'wallSeconds'), y = at(R.raw[k][b][s], T, 'wallSeconds'); if (x == null || y == null) ex.push(s); else d.push(x - y); } return { budgetSeconds: T, ...paired(d), excludedSeeds: ex.length }; };
const a = ['flop6', 'flop6w'].map(k => { const c = cmp(k, 1); return { comparison: k + '@1', ratio: c.ratio, ci95: c.ratioCi95, holmP: c.holmP, pass: c.ratio <= minRatio && c.holmP < 0.05 && c.ratio < 1 }; });
const b = ['flop6@0.3', 'flop6@1', 'flop6w@0.3', 'flop6w@1'].map(x => { const [k, T] = x.split('@'), c = cmp(k, +T); return { comparison: x, ratio: c.ratio, pass: c.ratio <= 1 }; });
const c = ['river3-chip', 'turn4'].flatMap(k => G(k).equalTime[C].map(x => { const counted = x.excludedSeeds <= 0.25 * seeds.length && x.ratio != null; return { comparison: k + '@' + x.budgetSeconds, ratio: x.ratio ?? null, ci95: x.ratioCi95 ?? null, n: x.n, excludedSeeds: x.excludedSeeds, counted, pass: counted ? x.ratioCi95[1] <= margin : null }; }));
const ok = l => l.every(x => x.pass !== false), promote = ok(a) && ok(b) && ok(c);
const resources = Object.fromEntries(R.games.map(g => [g.key, Object.fromEntries(Object.entries(g.arms).map(([arm, rows]) => { const f = rows[rows.length - 1]; return [arm, { finalDeals: f.deals, finalCommittedUpdates: f.updates, trainingSecondsMean: f.trainingSeconds.mean, evalSecondsMeanFinal: f.evalSeconds.mean, evalSecondsTotalMean: rows.reduce((s, r) => s + r.evalSeconds.mean, 0), trainingPeakRssMiBMax: f.peakRssMiB, threadsUsedMax: f.threadsUsed, finalNashConvMean: f.nashConv.mean, finalSeatGainsMean: f.seats.map(s => s.gain.mean) }]; }))]));
const warmVsP64 = Object.fromEntries(R.games.map(g => [g.key, g.budgets.map(T => vs(g.key, C, 'parallel64', T))]));
const res = { tool: 'decide51', input: inp.split('/').pop(), build: R.build, cpu: R.cpu, logicalCpus: R.logicalCpus, seeds: [seeds[0], seeds[seeds.length - 1]], n: seeds.length, candidate: C,
  rule: { a: a, b: b, c: c }, failedControlComparisons: c.filter(x => x.pass === false).map(x => x.comparison), decision: promote ? 'promote ' + C : 'keep the 5.0 default (batchDeals 1); ' + C + ' stays opt-in',
  secondary: { warmVsParallel64EqualTime: warmVsP64, resourcesAtFinalCheckpoint: resources } };
fs.writeFileSync(out, JSON.stringify(res, null, 1));
console.log(res.decision); for (const x of [...a, ...b, ...c]) console.log(x.comparison.padEnd(18), x.ratio == null ? 'excluded' : x.ratio.toFixed(3), x.ci95 ? '[' + x.ci95.map(v => v.toFixed(3)).join(',') + ']' : '', x.pass);
for (const [k, l] of Object.entries(warmVsP64)) console.log('warm/p64', k.padEnd(12), l.map(x => x.budgetSeconds + ':' + (x.ratio ? x.ratio.toFixed(2) + '[' + x.ratioCi95.map(v => v.toFixed(2)).join(',') + ']' : '-')).join(' '));
for (const [k, o] of Object.entries(resources)) for (const [arm, r] of Object.entries(o)) console.log(k.padEnd(12), arm.padEnd(11), 'deals', r.finalDeals, 'updates', r.finalCommittedUpdates, 'train s', r.trainingSecondsMean.toFixed(2), 'eval s', r.evalSecondsTotalMean.toFixed(2), 'rss', r.trainingPeakRssMiBMax, 'thr', r.threadsUsedMax, 'seats', r.finalSeatGainsMean.map(v => v.toExponential(1)).join(' '));
