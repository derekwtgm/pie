// EightMax 4.7 (Priority 9): 4.6 versus 4.7 native training speed on mathematically equivalent
// workloads. Both versions train the same spec, update count and thread count; the resulting
// state files must be byte-identical (otherwise the comparison is void and reported as such).
// Rounds are interleaved with alternating version order. Statistic: paired log time ratio
// (4.7 / 4.6) per round, mean with a Student-t 95% interval; geometric-mean ratio reported.
// usage: node tools/bench47.js <mwcli-4.6> <mwcli-4.7> <out.json> [--rounds=9] [--threads=1]
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), { execFileSync } = require('node:child_process');
const E = require('./loadlib'); for (const l of ['lib_runouts', 'lib_wide', 'lib_river']) require('../web/' + l);
const args = process.argv.slice(2), [old, cur, out] = args.filter(a => !a.startsWith('--'));
const opt = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const rounds = +opt('rounds', 9), threads = +opt('threads', 1);
const base = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128, privateSeed: 11 };
const G = {
  'six-player flop, chip EV (side pots, all-ins)': [{ board: 'Td7c2h', dealt: 8, common: 1.5, stacks: [20, 35, 8, 50, 14, 3], prior: Array(6).fill(2.5), folded: [1, 2.5], ranges: ['AhTh,7s7d', 'KdTs,9c8c', 'QsQd,Ac7h', 'JhTc,6s5s', 'AdKc,2s2d', '8h8d,As2c'], streets: { flop: { bets: 'a', raises: '', maxBets: 1 } } }, 30000],
  'three-player river, chip EV': [{ board: 'Ks8d5h2c2s', common: 6, stacks: [4, 12, 30], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc'], streets: { river: { bets: '75,a', raises: 'a', maxBets: 2 } } }, 60000],
  'heads-up turn and river, two sizes': [{ board: 'Ks8d5h2c', common: 8, stacks: [30, 30], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd'], streets: { turn: { bets: '50,a', raises: 'a', maxBets: 2 }, river: { bets: '50,a', raises: 'a', maxBets: 2 } } }, 40000],
  'four-player bubble push/fold, ICM': [{ preflop: { mode: 'shove' }, dealt: 4, common: 0, board: '', stacks: [12, 7, 20, 4], ranges: ['AsAh,7c2d:0.5', 'KsKh:0.75,8c3d', 'QsQh,6d5d', 'JsJh:0.5,9s8s'], icm: { payouts: [50, 30, 20] }, batchDeals: 4, actionStreams: 'deal' }, 20000],
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em47-bench-'));
const specs = Object.entries(G).map(([name, [cfg, updates]]) => { const f = path.join(dir, name.replace(/\W+/g, '_') + '.json'); fs.writeFileSync(f, JSON.stringify(E.MultiwayGame({ ...base, ...cfg }).nativeSpec())); return [name, f, updates]; });
specs.push(['eight-player linked study, random ranges, ICM (4.5 fixture)', path.join(__dirname, '..', '..', 'validation', '4.5', 'fixtures', 'icm-final8.spec.json'), 600]);
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const run = (cli, spec, n) => { const st = path.join(dir, 'st'); const t0 = process.hrtime.bigint(); const info = JSON.parse(execFileSync(cli, [spec, n, threads, st, 512], { encoding: 'utf8' })); const wall = Number(process.hrtime.bigint() - t0) / 1e9; return { train: info.wallSeconds, process: wall, peak: info.processPeakRssMiB, sha: sha(st) }; };
const tq = df => ({ 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 14: 2.145, 19: 2.093 })[df] || 2.0;
const report = { tool: 'bench47', generated: new Date().toISOString(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, threads, rounds, versions: { '4.6': old, '4.7': cur }, method: 'interleaved rounds (version order alternating); per round the 4.7/4.6 training wall-time ratio; mean of log ratios with Student-t 95% interval; outputs must be byte-identical', scenarios: [] };
for (const [name, spec, n] of specs) {
  const rows = []; let identical = true;
  run(old, spec, Math.max(1, n >> 4)); run(cur, spec, Math.max(1, n >> 4));   // warm the file cache
  for (let r = 0; r < rounds; r++) {
    const order = r % 2 ? ['4.7', '4.6'] : ['4.6', '4.7'], res = {};
    for (const v of order) res[v] = run(v === '4.6' ? old : cur, spec, n);
    identical &&= res['4.6'].sha === res['4.7'].sha;
    rows.push(res);
  }
  const lr = rows.map(x => Math.log(x['4.7'].train / x['4.6'].train)), m = lr.reduce((a, b) => a + b, 0) / lr.length, sd = Math.sqrt(lr.reduce((a, b) => a + (b - m) ** 2, 0) / (lr.length - 1)), h = tq(lr.length - 1) * sd / Math.sqrt(lr.length);
  const med = v => { const s = rows.map(x => x[v].train).sort((a, b) => a - b); return s[s.length >> 1]; };
  const sc = { scenario: name, updates: n, identicalOutputs: identical, stateSha256: rows[0]['4.6'].sha, median46: med('4.6'), median47: med('4.7'), ratio: Math.exp(m), ratioCi95: [Math.exp(m - h), Math.exp(m + h)], verdict: !identical ? 'outputs differ: comparison void' : m + h < 0 ? '4.7 faster (supported)' : m - h > 0 ? '4.7 slower (supported)' : 'no supported difference', peakRssMiB46: Math.max(...rows.map(x => x['4.6'].peak)), peakRssMiB47: Math.max(...rows.map(x => x['4.7'].peak)), rounds: rows };
  report.scenarios.push(sc);
  console.log(name.padEnd(60), 'median', sc.median46.toFixed(3), '->', sc.median47.toFixed(3), 's  ratio', sc.ratio.toFixed(3), '[' + sc.ratioCi95.map(x => x.toFixed(3)).join(', ') + ']', identical ? 'identical' : 'DIFFERENT', sc.verdict);
}
fs.writeFileSync(out, JSON.stringify(report, null, 1));
fs.rmSync(dir, { recursive: true, force: true });
