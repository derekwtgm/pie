// EightMax 4.6: re-analysis of the 4.5 convergence study (validation/4.5/convergence/convergence45.json)
// with the equal-deals comparison on natural-log NashConv (paired over the same seeds, Holm over the
// same 288-comparison family: equal-time comparisons are taken from the file unchanged).
// usage: node tools/reanalyze_convergence46.js <convergence45.json> <out.json>
'use strict';
const fs = require('node:fs'); const [inp, out] = process.argv.slice(2);
const d = JSON.parse(fs.readFileSync(inp, 'utf8'));
function betacf(a, b, x) { let c = 1, dd = 1 - (a + b) * x / (a + 1); dd = 1 / dd; let h = dd; for (let m = 1; m < 200; m++) { const m2 = 2 * m; let aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2)); dd = 1 + aa * dd; c = 1 + aa / c; dd = 1 / dd; h *= dd * c; aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1)); dd = 1 + aa * dd; c = 1 + aa / c; dd = 1 / dd; const del = dd * c; h *= del; if (Math.abs(del - 1) < 1e-14) break; } return h; }
function lgamma(z) { const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; let x = z, y = z, t = x + 5.5; t -= (x + 0.5) * Math.log(t); let s = 1.000000000190015; for (const c of g) s += c / ++y; return -t + Math.log(2.5066282746310005 * s / x); }
function ibeta(a, b, x) { if (x <= 0) return 0; if (x >= 1) return 1; const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x)); return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b; }
const pT = (t, df) => Number.isFinite(t) ? ibeta(df / 2, 0.5, df / (df + t * t)) : 0;
const paired = (a, b) => { const x = a.map((v, i) => v - b[i]), n = x.length, m = x.reduce((s, v) => s + v, 0) / n, sd = Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1)), t = sd > 0 ? m / (sd / Math.sqrt(n)) : (m === 0 ? 0 : Infinity); return { meanLogRatio: m, ratio: Math.exp(m), t, df: n - 1, p: pT(t, n - 1) }; };
const L = v => Math.log(Math.max(v, 1e-300));
const rows = [];
for (const g of d.games) for (const [v, cmp] of Object.entries(g.comparison)) cmp.forEach((c, i) => {
  const a = g.variants[v][i].perSeed.map(L), b = g.variants.linear[i].perSeed.map(L);
  rows.push({ game: g.key, variant: v, deals: c.deals, test: 'equalSamples(log)', ...paired(a, b) });
  rows.push({ game: g.key, variant: v, deals: c.deals, test: 'equalTime(log, from 4.5 file)', meanLogRatio: c.equalTime.meanDifference, ratio: Math.exp(c.equalTime.meanDifference), t: c.equalTime.t, df: c.equalTime.df, p: c.equalTime.p });
});
rows.slice().sort((a, b) => a.p - b.p).reduce((run, c, i) => (c.holmP = Math.max(run, Math.min(1, (rows.length - i) * c.p))), 0);
for (const r of rows) r.verdict = r.holmP < 0.05 ? (r.meanLogRatio < 0 ? 'better' : 'worse') : '-';
const tally = {}; for (const r of rows) { const k = r.variant; tally[k] ??= { better: 0, worse: 0, comparisons: 0 }; tally[k].comparisons++; if (r.verdict !== '-') tally[k][r.verdict]++; }
fs.writeFileSync(out, JSON.stringify({ tool: 'reanalyze_convergence46', source: inp, family: rows.length, holm: 'family-wise 5%', tally, rows }, null, 1));
for (const g of d.games) for (const v of Object.keys(g.comparison)) { const r = rows.filter(x => x.game === g.key && x.variant === v); console.log(g.key.padEnd(12), v.padEnd(16), 'deals:', r.filter(x => x.test.startsWith('equalS')).map(x => x.verdict === '-' ? '-' : x.verdict[0].toUpperCase()).join(''), ' time:', r.filter(x => x.test.startsWith('equalT')).map(x => x.verdict === '-' ? '-' : x.verdict[0].toUpperCase()).join(''), ' ratio@last-deals', r.filter(x => x.test.startsWith('equalS')).slice(-1)[0].ratio.toFixed(3)); }
console.log(JSON.stringify(tally));
