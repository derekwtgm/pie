// EightMax 3.9: interleaved training-time comparison of two mwcli builds on
// longer runs (seconds, not milliseconds), 7 paired repetitions (order
// alternates), identical specs. Reports medians, the paired median ratio with
// a sign-test style count, and whether every pair of states is byte-identical.
// usage: node tools/timing39.js <mwcli-A (3.8)> <mwcli-B (3.9)> <out.json> [reps]
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), { execFileSync } = require('node:child_process');
const E = require('./loadlib'); for (const l of ['lib_runouts', 'lib_wide', 'lib_river']) require('../web/' + l);
const [a, b, out, repsArg] = process.argv.slice(2), reps = +repsArg || 7, threads = Math.min(4, os.cpus().length);
const base = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128, privateSeed: 1 };
const cases = [
  ['Heads-up river, 200,000 deals', { board: 'Qs9h4d2c7s', common: 10, stacks: [40, 40], ranges: ['AsQd,KhQh,9s9c,JhTh,8d7d,AhKd,Ts8s,AcAd,5h5d', 'QcJc,TdTc,As4s,KdJd,6s5s,9d8d,7c7d,AhJh,Kc2s'], streets: { river: { bets: '50,a', raises: '2.5x', maxBets: 2 } } }, 200000],
  ['Three-player river, 60,000 deals', { board: 'Ks8d5h2c2s', common: 12, stacks: [30, 30, 30], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc,QhJh,9c9d', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd,6h6d,4c3c', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc,6s5s,AdJd'], streets: { river: { bets: '50,125', raises: '2.5x', maxBets: 2 } } }, 60000],
  ['Eight-player linked preflop to river, 1,500 x 16 deals', { preflop: { mode: 'linked', opens: '2,a', raises: '2.75x,a', maxBets: 3 }, board: '', dealt: 8, common: 0, stacks: [24.9, 18, 40, 12, 30, 9, 55, 20], ranges: Array(8).fill('random'), streets: { flop: { bets: '33,75', raises: '3x', maxBets: 2 }, turn: { bets: '66', raises: 'a', maxBets: 2 }, river: { bets: '75,a', raises: '', maxBets: 1 } }, batchDeals: 16, actionStreams: 'deal' }, 1500],
  ['Eight-player final-table ICM, 1,000 x 16 deals', { preflop: { mode: 'linked', opens: '2.2,a', raises: 'a', maxBets: 2 }, board: '', dealt: 8, common: 0, stacks: [30, 22, 15, 40, 9, 18, 25, 12], ranges: Array(8).fill('random'), icm: { payouts: [30, 20, 14, 11, 9, 7, 5, 4] }, streets: { flop: { bets: '50', raises: '', maxBets: 1 }, turn: { bets: 'a', raises: '', maxBets: 1 }, river: { bets: 'a', raises: '', maxBets: 1 } }, batchDeals: 16, actionStreams: 'deal' }, 1000],
  ['Short-stack multiway all-ins, 4,000 x 4 deals', { board: 'Td7c2h', dealt: 8, common: 1.5, stacks: [20, 35, 8, 50, 14, 3], prior: Array(6).fill(2.5), folded: [1, 2.5], ranges: Array(6).fill('22+,A2s+,K9s+,QTs+,JTs,ATo+,KJo+:0.6'), streets: { flop: { bets: '33,a', raises: '3x,a', maxBets: 3 }, turn: { bets: '50,g', raises: 'a', maxBets: 2 }, river: { bets: '75,150', raises: 'a', maxBets: 2 } }, batchDeals: 4, actionStreams: 'deal' }, 4000],
];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em39-time-'));
const body = x => crypto.createHash('sha256').update(x.subarray(12 + x.readUInt32LE(8))).digest('hex');
const median = v => { const s = [...v].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const result = [];
for (const [name, cfg, updates] of cases) {
  const spec = path.join(dir, 'spec.json'); fs.writeFileSync(spec, JSON.stringify(E.MultiwayGame({ ...base, ...cfg }).nativeSpec()));
  const ta = [], tb = [], ra = [], rb = []; let identical = 0;
  for (let r = 0; r < reps; r++) {
    const order = r % 2 ? [['b', b], ['a', a]] : [['a', a], ['b', b]], sha = {};
    for (const [label, cli] of order) {
      const st = path.join(dir, label + '.state'), info = JSON.parse(execFileSync(cli, [spec, updates, threads, st, 2048].map(String), { encoding: 'utf8' }));
      (label === 'a' ? ta : tb).push(info.wallSeconds); (label === 'a' ? ra : rb).push(info.processPeakRssMiB); sha[label] = body(fs.readFileSync(st));
    }
    identical += sha.a === sha.b;
  }
  const ratios = ta.map((x, i) => tb[i] / x), faster = ratios.filter(x => x < 1).length;
  const row = { name, updates, threads, reps, seconds38: ta, seconds39: tb, median38: median(ta), median39: median(tb), medianPairedRatio: median(ratios), pairs39Faster: faster, peakRss38MiB: Math.max(...ra), peakRss39MiB: Math.max(...rb), identicalPairs: identical };
  result.push(row); console.log(name.padEnd(56), '3.8', row.median38.toFixed(3), 's  3.9', row.median39.toFixed(3), 's  ratio', row.medianPairedRatio.toFixed(3), ' 3.9 faster in', faster + '/' + reps, ' identical', identical + '/' + reps);
}
fs.writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), cpu: os.cpus()[0].model, logicalProcessors: os.cpus().length, cases: result }, null, 1));
fs.rmSync(dir, { recursive: true, force: true });
