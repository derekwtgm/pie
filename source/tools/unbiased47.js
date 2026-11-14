// EightMax 4.7 (Priority 2): engine-level unbiasedness check of the experimental
// external-sampling estimators against the validated default.
//
// From an empty table (uniform policy) the FIRST traversal of an update (seat 0) adds
// exactly one sampled estimate of seat 0's counterfactual regrets and average-strategy
// increments of the uniform profile (linear step 1). Their expectation is the same for
// every unbiased estimator. We train 1 update with N independent seeds per estimator,
// read seat 0's rows from the EMMW4 state file (keyed by betting path, hand and cards so
// that state numbering does not matter), and compare each component's mean between the
// default and each candidate with a two-sample (Welch) z statistic. A component that is
// never visited counts as 0 in that run. Bonferroni over all components and candidates.
// Seat 1's rows are NOT compared: its traversal sees seat 0's freshly updated (random)
// policy, so its expectation depends on the variance of seat 0's update.
// usage: node tools/unbiased47.js <mwcli> <out.json> [runs=2000] [--game=hu-river|river3]
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process');
const E = require('./loadlib'); for (const l of ['lib_runouts', 'lib_wide', 'lib_river']) require('../web/' + l);
const args = process.argv.slice(2), [cli, out] = args.filter(a => !a.startsWith('--')), N = +(args.filter(a => !a.startsWith('--'))[2] || 2000);
const gameArg = (args.find(a => a.startsWith('--game=')) || '--game=hu-river').slice(7);
const GAMES = {
  'hu-river': { board: 'Ks8d5h2c2s', common: 10, stacks: [20, 20], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd:0.5,KcJc,5d5c,8h7h:0.25,AdQd,JdTd'], streets: { river: { bets: '50,a', raises: 'a', maxBets: 2 } } },
  'river3': { board: 'Ks8d5h2c2s', common: 6, stacks: [4, 12, 30], ranges: ['AhKh,KdQd,8s8h,JsTs', 'AsKd,KcJc,5d5c,8h7h', 'Kc9c,QsQc,7d7c,Ah5s'], streets: { river: { bets: '75,a', raises: 'a', maxBets: 2 } } },
};
const base = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128, ...GAMES[gameArg] };
const variants = [['default', {}], ['ownHandEnumeration', { ownHandEnumeration: true }], ['ownHandEnumeration+terminalBaseline', { ownHandEnumeration: true, terminalBaseline: true }], ['terminalBaseline', { terminalBaseline: true }]];
// EMMW4: magic(8) u32 headerLen, header JSON, u32 stateCount, states (u32 parent, u8 slot, kind, actor, length, k), u32 rows, rows.
function readState(file) {
  const b = fs.readFileSync(file); let o = 8; const hl = b.readUInt32LE(o); o += 4; const header = JSON.parse(b.subarray(o, o + hl).toString()); o += hl;
  const sc = b.readUInt32LE(o); o += 4; const parent = [], slot = [], actor = [];
  for (let i = 0; i < sc; i++) { parent.push(b.readUInt32LE(o)); slot.push(b[o + 4]); actor.push(b[o + 6]); o += 9; }
  const pathOf = id => { const p = []; while (id !== 0 && id !== 0xffffffff) { p.push(slot[id]); id = parent[id]; } return p.reverse().join('.'); };
  const rc = b.readUInt32LE(o); o += 4; const rows = new Map();
  for (let r = 0; r < rc; r++) {
    const st = b.readUInt32LE(o), hand = b.readUInt16LE(o + 4), cards = [...b.subarray(o + 6, o + 11)].join(','), k = b[o + 11]; o += 12;
    const v = []; for (let i = 0; i < 2 * k; i++) v.push(b.readDoubleLE(o + 8 * i)); o += 16 * k; if (header.rowSync) o += 4;
    rows.set(pathOf(st) + '|' + hand + '|' + cards + '|' + actor[st], v);
  }
  return { header, rows };
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em47-unbiased-'));
const samples = {};
for (const [name, extra] of variants) {
  const acc = new Map(); const t0 = Date.now();
  for (let s = 1; s <= N; s++) {
    const spec = path.join(dir, 'spec.json'), st = path.join(dir, 'st');
    fs.writeFileSync(spec, JSON.stringify(E.MultiwayGame({ ...base, ...extra, privateSeed: 5000 + s }).nativeSpec()));
    execFileSync(cli, [spec, 1, 1, st, 64], { encoding: 'utf8' });
    for (const [key, v] of readState(st).rows) {
      if (!key.endsWith('|0')) continue;   // seat 0 (first traverser) only
      if (!acc.has(key)) acc.set(key, { n: 0, sum: v.map(() => 0), sq: v.map(() => 0) });
      const a = acc.get(key); v.forEach((x, i) => { a.sum[i] += x; a.sq[i] += x * x; }); a.n++;
    }
  }
  samples[name] = { acc, seconds: (Date.now() - t0) / 1000 };
  console.log(name, 'rows seen', acc.size, ((Date.now() - t0) / 1000).toFixed(1) + ' s');
}
// Normal quantile (Acklam) for the Bonferroni critical value.
function qnorm(p) { const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00], b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01], c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00], d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  if (p < 0.02425) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - 0.02425) return -qnorm(1 - p); const q = p - 0.5, r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
const keys = new Set(); for (const v of Object.values(samples)) for (const k of v.acc.keys()) keys.add(k);
const moments = (acc, key, i) => { const a = acc.get(key); const s = a ? a.sum[i] : 0, q = a ? a.sq[i] : 0; const m = s / N; return { mean: m, var: Math.max(0, (q / N - m * m) * N / (N - 1)) }; };
const width = key => { for (const v of Object.values(samples)) if (v.acc.has(key)) return v.acc.get(key).sum.length; return 0; };
let comps = 0; for (const k of keys) comps += width(k);
const comparisons = (variants.length - 1) * comps, crit = qnorm(1 - 0.001 / (2 * comparisons));
const report = { tool: 'unbiased47', game: gameArg, runsPerEstimator: N, components: comps, familywiseAlpha: 0.001, bonferroniCritical: crit, method: 'two-sample Welch z per (row, value) component of seat 0 after one update from the uniform profile; regrets and average-strategy increments; Bonferroni over all components and candidates', candidates: [] };
const def = samples.default.acc; let defVar = 0; for (const k of keys) { const w = width(k); for (let i = 0; i < w / 2; i++) defVar += moments(def, k, i).var; }
for (const [name] of variants.slice(1)) {
  let maxZ = 0, worst = null, totVar = 0;
  for (const k of keys) { const w = width(k); for (let i = 0; i < w; i++) {
    const x = moments(def, k, i), y = moments(samples[name].acc, k, i), se = Math.sqrt((x.var + y.var) / N);
    const z = se > 0 ? (y.mean - x.mean) / se : (Math.abs(y.mean - x.mean) < 1e-12 ? 0 : Infinity);
    if (Math.abs(z) > maxZ) { maxZ = Math.abs(z); worst = { row: k, component: i < w / 2 ? 'regret ' + i : 'average ' + (i - w / 2), defaultMean: x.mean, candidateMean: y.mean }; }
    if (i < w / 2) totVar += y.var;
  } }
  report.candidates.push({ estimator: name, maxAbsZ: maxZ, consistentWithDefaultExpectation: maxZ < crit, worstComponent: worst, regretVarianceRatioToDefault: totVar / defVar, seconds: samples[name].seconds });
  console.log(name.padEnd(38), 'max|z|', maxZ.toFixed(2), 'crit', crit.toFixed(2), 'variance ratio', (totVar / defVar).toFixed(3));
}
report.defaultSeconds = samples.default.seconds;
report.passed = report.candidates.every(c => c.consistentWithDefaultExpectation);
fs.writeFileSync(out, JSON.stringify(report, null, 1));
fs.rmSync(dir, { recursive: true, force: true });
process.exit(report.passed ? 0 : 1);
