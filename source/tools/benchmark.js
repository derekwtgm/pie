'use strict';
// Multiway solver benchmark: iterations per second, peak memory and strategy
// storage for 6-, 7- and 8-player configurations, each in a fresh process.
// Usage: node tools/benchmark.js [output.json] [--source=<dir with web/ and tools/>] [--repeat=3]
// --source lets the same configurations run on an older release for a
// before/after comparison (configurations use only options both understand).
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), { execFileSync } = require('node:child_process');
const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const out = args.find((x) => !x.startsWith('--'));
const source = path.resolve(opt('source', path.join(__dirname, '..'))), repeat = +opt('repeat', 3);
const holes = ['QhQd,9c9d', 'AsAd,KsTh', 'JhJd,8s8d', 'AcKd,5c5d', 'AhKh,6s6h', 'TsTc,7c7d', '9h9s,AdQd', 'KhQh,4c4d'];
const tree = { flop: { bets: '25,50', raises: '2.5x', maxBets: 2 }, turn: { bets: '50,100', raises: '2.5x', maxBets: 2 }, river: { bets: '75,125', raises: '2.5x', maxBets: 2 } };
const post = (n, board) => ({ board, dealt: 8, common: 0, streets: tree, stacks: Array(n).fill(22.9), prior: Array(n).fill(2), ranges: holes.slice(0, n),
  privateMode: 'sampled', abstraction: 'detailed', evaluationDeals: 512, privateSeed: 17 });
const linked = (n) => ({ preflop: { mode: 'linked', opens: '2', raises: '3x,a', maxBets: 3 }, board: '', dealt: 8, common: 0, stacks: Array(n).fill(25),
  ranges: Array(n).fill('random'), streets: { flop: { bets: '50', raises: '', maxBets: 1 }, turn: { bets: '75', raises: '', maxBets: 1 }, river: { bets: '100', raises: '', maxBets: 1 } },
  privateMode: 'sampled', evaluationDeals: 512, privateSeed: 17 });
const cases = [
  ['6-player flop, 2 sizes + raise per street', post(6, '2c 4d 7h'), 2000],
  ['7-player flop, 2 sizes + raise per street', post(7, '2c 4d 7h'), 2000],
  ['8-player flop, 2 sizes + raise per street', post(8, '2c 4d 7h'), 2000],
  ['8-player river, 2 sizes + raise', post(8, '2c 4d 7h 9s Jc'), 4000],
  ['6-player linked preflop-river, random ranges, 25 bb', linked(6), 3000],
  ['8-player linked preflop-river, random ranges, 25 bb', linked(8), 3000],
  ['8-player linked ICM 50/30/20, random ranges, 25 bb', { ...linked(8), icm: { payouts: [50, 30, 20], others: [] } }, 1500]];
const child = `
const path=require('path');const src=process.argv[1];process.chdir(src);
const EM=require(path.join(src,'tools/loadlib.js'));for(const l of ['lib_runouts','lib_wide','lib_river'])require(path.join(src,'web',l+'.js'));
const cfg=JSON.parse(process.argv[2]),N=+process.argv[3];
const t0=process.hrtime.bigint();const g=EM.MultiwayGame(cfg);const build=Number(process.hrtime.bigint()-t0)/1e9;
const t1=process.hrtime.bigint();g.iterate(N);const train=Number(process.hrtime.bigint()-t1)/1e9;
const m=g.metrics();
console.log(JSON.stringify({build,train,itPerSec:N/train,maxRSSMiB:process.resourceUsage().maxRSS/1024,strategyMiB:m.strategyMiB,infos:m.infos,algorithm:m.algorithm,ev:m.ev,limitReached:m.limitReached}));`;
const results = [];
for (const [name, cfg, iterations] of cases) {
  const runs = [];
  for (let r = 0; r < repeat; r++) runs.push(JSON.parse(execFileSync(process.execPath, ['-e', child, source, JSON.stringify(cfg), String(iterations)], { maxBuffer: 1 << 24 }).toString()));
  const speeds = runs.map((x) => x.itPerSec).sort((a, b) => a - b), median = speeds[Math.floor(speeds.length / 2)];
  const row = { name, iterations, medianItPerSec: median, minItPerSec: speeds[0], maxItPerSec: speeds[speeds.length - 1],
    maxRSSMiB: Math.max(...runs.map((x) => x.maxRSSMiB)), strategyMiB: runs[0].strategyMiB, infos: runs[0].infos, algorithm: runs[0].algorithm,
    deterministic: runs.every((x) => JSON.stringify(x.ev) === JSON.stringify(runs[0].ev)), ev: runs[0].ev };
  results.push(row);
  console.log(`${name}: ${median.toFixed(0)} it/s (min ${speeds[0].toFixed(0)}, max ${speeds[speeds.length - 1].toFixed(0)}), peak RSS ${row.maxRSSMiB.toFixed(0)} MiB, strategy ${row.strategyMiB.toFixed(1)} MiB, ${row.infos} information sets`);
}
const report = { generated: new Date().toISOString(), source, node: process.version, platform: os.platform() + ' ' + os.release(), cpu: os.cpus()[0]?.model, cores: os.cpus().length,
  memoryGiB: os.totalmem() / 2 ** 30, repeat, results };
if (out) fs.writeFileSync(out, JSON.stringify(report, null, 1) + '\n');
