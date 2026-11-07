'use strict';
// Controlled throughput benchmark, EightMax 2.8 vs 2.9.
// Usage: node tools/perf29.js <2.8 source dir> <native mwcli> <out.json> [--repeat=3]
// Part A: the JavaScript engines of both versions on identical study definitions
//   (each run in a fresh process, nothing else running; median of the repeats).
//   Updates/s are comparable between versions because the algorithm, batch size
//   and tree are identical (the EV vectors are checked for equality). State visits
//   per sampled deal are reported so different workloads are not compared by
//   updates/s alone.
// Part B: the 2.9 native engine on the same spots with Exact cards and full
//   betting traversal (the native engine's requirements) at 1, 2 and 4 threads,
//   against the 2.9 JavaScript engine running that same exact-card game.
const path = require('path'), fs = require('fs'), os = require('os'), { execFileSync } = require('child_process');
const [old, cli, out] = process.argv.slice(2);
const repeat = +((process.argv.find((x) => x.startsWith('--repeat=')) || '--repeat=3').slice(9));
const here = path.resolve(__dirname, '..');
const holes = ['QhQd,9c9d', 'AsAd,KsTh', 'JhJd,8s8d', 'AcKd,5c5d', 'AhKh,6s6h', 'TsTc,7c7d', '9h9s,AdQd', 'KhQh,4c4d'];
const tree = { flop: { bets: '25,50', raises: '2.5x', maxBets: 2 }, turn: { bets: '50,100', raises: '2.5x', maxBets: 2 }, river: { bets: '75,125', raises: '2.5x', maxBets: 2 } };
const post = (n, board, stacks = 22.9) => ({ board, dealt: 8, common: 0, streets: tree, stacks: Array(n).fill(stacks), prior: Array(n).fill(2), ranges: holes.slice(0, n),
  privateMode: 'sampled', abstraction: 'detailed', batchDeals: 4, evaluationDeals: 512, privateSeed: 17 });
const linked = (n) => ({ preflop: { mode: 'linked', opens: '2', raises: '3x,a', maxBets: 3 }, board: '', dealt: 8, common: 0, stacks: Array(n).fill(25), ranges: Array(n).fill('random'),
  streets: { flop: { bets: '50', raises: '', maxBets: 1 }, turn: { bets: '75', raises: '', maxBets: 1 }, river: { bets: '100', raises: '', maxBets: 1 } }, privateMode: 'sampled', batchDeals: 4, evaluationDeals: 512, privateSeed: 17 });
const cases = [
  ['2-player river', post(2, '2c 4d 7h 9s Jc'), 20000], ['3-player river', post(3, '2c 4d 7h 9s Jc'), 20000], ['4-player flop', post(4, '2c 4d 7h', 12), 3000],
  ['6-player flop', post(6, '2c 4d 7h'), 1500], ['7-player flop', post(7, '2c 4d 7h'), 1500], ['8-player flop', post(8, '2c 4d 7h'), 1500],
  ['8-player river', post(8, '2c 4d 7h 9s Jc'), 3000], ['8-player linked preflop-river', linked(8), 2000],
  ['8-player linked ICM 50/30/20', { ...linked(8), icm: { payouts: [50, 30, 20], others: [] } }, 1000]];
const child = `
const path=require('path');const src=process.argv[1];
const EM=require(path.join(src,'tools/loadlib.js'));for(const l of ['lib_runouts','lib_wide','lib_river'])require(path.join(src,'web',l+'.js'));
const cfg=JSON.parse(process.argv[2]),N=+process.argv[3];
const g=EM.MultiwayGame(cfg);const t1=process.hrtime.bigint();g.iterate(N);const train=Number(process.hrtime.bigint()-t1)/1e9;
const m=g.metrics();
console.log(JSON.stringify({train,updatesPerSec:N/train,dealsPerSec:(g.trainingDeals??m.trainingDeals)/train,deals:g.trainingDeals??m.trainingDeals,stateVisits:m.stateVisits,maxRSSMiB:process.resourceUsage().maxRSS/1024,strategyMiB:m.strategyMiB,algorithm:m.algorithm,ev:m.ev}));`;
const run = (src, cfg, n) => JSON.parse(execFileSync(process.execPath, ['-e', child, src, JSON.stringify(cfg), String(n)], { maxBuffer: 1 << 24 }).toString());
const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
const partA = [];
for (const [name, cfg, n] of cases) {
  const row = { name, updates: n };
  for (const [label, src] of [['2.8', old], ['2.9', here]]) {
    const runs = []; for (let r = 0; r < repeat; r++) runs.push(run(src, cfg, n));
    row[label] = { medianUpdatesPerSec: med(runs.map((x) => x.updatesPerSec)), min: Math.min(...runs.map((x) => x.updatesPerSec)), max: Math.max(...runs.map((x) => x.updatesPerSec)),
      medianDealsPerSec: med(runs.map((x) => x.dealsPerSec)), visitsPerDeal: runs[0].stateVisits / runs[0].deals, peakRSSMiB: Math.max(...runs.map((x) => x.maxRSSMiB)), algorithm: runs[0].algorithm, ev: runs[0].ev };
  }
  row.identicalEV = JSON.stringify(row['2.8'].ev) === JSON.stringify(row['2.9'].ev);
  row.change = row['2.9'].medianUpdatesPerSec / row['2.8'].medianUpdatesPerSec - 1;
  partA.push(row);
  console.log(`${name}: 2.8 ${row['2.8'].medianUpdatesPerSec.toFixed(0)} u/s, 2.9 ${row['2.9'].medianUpdatesPerSec.toFixed(0)} u/s (${(100 * row.change).toFixed(1)}%), identical EV ${row.identicalEV}`);
}
// Part B
delete globalThis.EM;
const E = require(path.join(here, 'tools/loadlib.js')); for (const l of ['lib_runouts', 'lib_wide', 'lib_river']) require(path.join(here, 'web', l + '.js'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perf29-')), partB = [];
for (const [name, base, n] of cases) {
  if (base.preflop) { partB.push({ name, native: false, reason: 'preflop studies train in JavaScript (sampled betting traversal)' }); continue; }
  const cfg = { ...base, abstraction: 'exact', engine: 'native', batchDeals: 16 };
  const g = E.MultiwayGame(cfg), why = g.nativeSupport();
  if (why) { partB.push({ name, native: false, reason: why }); console.log(name + ': native not eligible: ' + why); continue; }
  const spec = g.nativeSpec(); fs.writeFileSync(path.join(tmp, 's.json'), JSON.stringify(spec));
  // size the run to roughly 2 s on one thread
  const probe = JSON.parse(execFileSync(cli, [path.join(tmp, 's.json'), '2', '1', path.join(tmp, 's.state'), '4096']).toString());
  const its = Math.max(4, Math.round(2 / Math.max(1e-4, probe.wallSeconds / 2)));
  const threads = {};
  for (const t of [1, 2, 4]) {
    const runs = []; for (let r = 0; r < repeat; r++) runs.push(JSON.parse(execFileSync(cli, [path.join(tmp, 's.json'), String(its), String(t), path.join(tmp, 's.state'), '4096']).toString()));
    threads[t] = { dealsPerSec: med(runs.map((x) => x.trainingDeals / x.wallSeconds)), traverseSeconds: med(runs.map((x) => x.seconds.traverse)), mergeSeconds: med(runs.map((x) => x.seconds.merge)), tableMiB: runs[0].tableMiB };
  }
  const jsRuns = []; for (let r = 0; r < repeat; r++) jsRuns.push(run(here, { ...cfg }, Math.max(2, Math.round(its / 8))));
  const jsDeals = med(jsRuns.map((x) => x.dealsPerSec));
  const row = { name, native: true, batchDeals: 16, nodes: spec.nodes.length, visitsPerDeal: probe.stateVisits / probe.trainingDeals, updates: its, threads, jsDealsPerSec: jsDeals,
    speedup1: threads[1].dealsPerSec / jsDeals, scaling4: threads[4].dealsPerSec / threads[1].dealsPerSec };
  partB.push(row);
  console.log(`${name} (exact cards, full tree, 16 deals/update): JS ${jsDeals.toFixed(0)} deals/s; native 1T ${threads[1].dealsPerSec.toFixed(0)}, 2T ${threads[2].dealsPerSec.toFixed(0)}, 4T ${threads[4].dealsPerSec.toFixed(0)} deals/s`);
}
fs.rmSync(tmp, { recursive: true, force: true });
fs.writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), cpu: os.cpus()[0].model, cores: os.cpus().length, memoryGiB: os.totalmem() / 2 ** 30, node: process.version, repeat, partA, partB }, null, 1));
