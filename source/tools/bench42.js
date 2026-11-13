// EightMax 4.2: reproducible 4.1 vs 4.2 benchmark on matched workloads.
// usage: node tools/bench42.js <mwcli-4.1> <mwcli-4.2> <out.json> [runs=3]
// Same specs, seeds, thread counts and requests for both versions. Training is
// unchanged in 4.2, so training rows must produce byte-identical state files
// (SHA-256 compared); evaluation rows must produce identical numbers (compared
// exactly) unless a row says otherwise. Each row reports the median and range
// of the wall time over `runs` runs, the process peak RSS when available, the
// device requested and the device observed, and the CPU/GPU board counts.
// No GPU is assumed: on a machine without CUDA every row runs on the CPU.
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
const E = require('./loadlib'); for (const l of ['lib_runouts', 'lib_wide', 'lib_river']) require('../web/' + l);
const [oldCli, newCli, out, runsArg] = process.argv.slice(2); const RUNS = +(runsArg || 3);
const root = path.join(__dirname, '..', '..'), fx = path.join(root, 'validation', '4.0', 'fixtures');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em42-bench-'));
const base = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128 };
const games = {
  huRiver: { ...base, board: 'Ks8d5h2c2s', common: 10, stacks: [20, 20], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd'], streets: { river: { bets: '50,a', raises: 'a', maxBets: 2 } }, privateSeed: 3 },
  threeRiver: { ...base, board: 'Ks8d5h2c2s', common: 12, stacks: [30, 30, 30], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc,QhJh,9c9d', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd,6h6d,4c3c', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc,6s5s,AdJd'], streets: { river: { bets: '50,125', raises: '2.5x', maxBets: 2 } }, privateSeed: 1 },
  bubble3: { ...base, board: 'Ks8d5h2c2s', common: 6, stacks: [4, 12, 30], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc'], icm: { payouts: [50, 30, 20], others: [10] }, streets: { river: { bets: '75,a', raises: 'a', maxBets: 2 } }, privateSeed: 2 },
  shortStack8: { ...base, preflop: { mode: 'shove' }, board: '', dealt: 8, common: 0, stacks: [30, 22, 15, 40, 9, 18, 25, 12], ranges: ['AsAh,7c2d', 'KsKh,8c3d', 'QsQh,9c4d', 'JsJh,Tc5d', 'TsTh,Jc6d', '9s9h,Qc2h', '8s8h,Kc3h', '7s7h,Ac4h'], icm: { payouts: [30, 20, 14, 11, 9, 7, 5, 4] }, batchDeals: 4, actionStreams: 'deal', privateSeed: 4 },
};
const specs = {}; for (const [k, g] of Object.entries(games)) { specs[k] = path.join(dir, k + '.json'); fs.writeFileSync(specs[k], JSON.stringify(E.MultiwayGame(g).nativeSpec())); }
specs.preflop8 = path.join(__dirname, '..', 'tests', 'fixtures', 'es-preflop8.json');
specs.sixFlop = path.join(__dirname, '..', 'tests', 'fixtures', 'es-grouped-six.json');
specs.finalTable8 = path.join(fx, 'push8-icm.spec.json');
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const med = v => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };
function exec(cli, args) { const t = process.hrtime.bigint(); const r = spawnSync(cli, args, { encoding: 'utf8', maxBuffer: 1 << 28 }); const s = Number(process.hrtime.bigint() - t) / 1e9; return { s, ok: r.status === 0, json: (() => { try { return JSON.parse(r.stdout); } catch { return null; } })(), err: (r.stderr || '').slice(0, 300) }; }
const report = { generated: new Date().toISOString(), cpu: os.cpus()[0].model, logicalCPUs: os.cpus().length, platform: os.platform() + ' ' + os.release(), runs: RUNS, versions: { old: '4.1', new: '4.2' }, gpu: 'none assumed; rows report the observed device', training: [], evaluation: [] };
// ---------------- training ----------------
const trainRows = [['Heads-up river', 'huRiver', 3000, 2], ['Three-player river', 'threeRiver', 2000, 2], ['Six-player flop (grouped fixture)', 'sixFlop', 60, 2], ['Eight-player preflop (fixture, full ranges)', 'preflop8', 200, 4],
  ['Short-stack multiway all-ins (8 seats, ICM)', 'shortStack8', 400, 4], ['Tournament bubble ICM (3 seats, side pots)', 'bubble3', 2000, 2], ['Eight-player final-table ICM (fixture spec)', 'finalTable8', 400, 4]];
for (const [label, key, its, threads] of trainRows) {
  const row = { label, spec: path.basename(specs[key]), iterations: its, threads, algorithm: 'external-sampling MCCFR (study default; unchanged in 4.2)' };
  for (const [v, cli] of [['v41', oldCli], ['v42', newCli]]) {
    const times = [], hashes = new Set(); let info = null;
    for (let r = 0; r < RUNS; r++) { const st = path.join(dir, key + v + r + '.state'); const x = exec(cli, [specs[key], its, threads, st, 1024]); if (!x.ok) { row[v] = { error: x.err }; break; } times.push(x.s); hashes.add(sha(st)); info = x.json; }
    if (!row[v]) row[v] = { medianSeconds: med(times), minSeconds: Math.min(...times), maxSeconds: Math.max(...times), engineWallSeconds: info && info.wallSeconds, trainingDeals: info && info.trainingDeals, peakRssMiB: info && info.processPeakRssMiB, stateSha256: [...hashes], deterministicAcrossRuns: hashes.size === 1 };
  }
  row.identicalState = !!(row.v41.stateSha256 && row.v42.stateSha256 && row.v41.stateSha256.join() === row.v42.stateSha256.join());
  row.speedup = row.v41.medianSeconds && row.v42.medianSeconds ? row.v41.medianSeconds / row.v42.medianSeconds : null;
  report.training.push(row); console.log('train', label.padEnd(46), 'v4.1', row.v41.medianSeconds?.toFixed(3), 'v4.2', row.v42.medianSeconds?.toFixed(3), 'identical', row.identicalState);
}
// states for evaluation rows (trained once with 4.2; identical with 4.1 as checked above)
const evalState = {}; for (const key of ['huRiver', 'shortStack8']) { evalState[key] = path.join(dir, key + 'v420.state'); }
evalState.finalTable8 = path.join(fx, 'push8-icm.state');
// ---------------- evaluation ----------------
const evalRows = [
  ['Heads-up equity (preflop)', '--equity', { hands: [[48, 49], [44, 45]], board: [], device: 'cpu', threads: 4 }],
  ['Three-player equity (preflop)', '--equity', { hands: [[48, 49], [44, 45], [40, 36]], board: [], device: 'cpu', threads: 4 }],
  ['Six-player equity (preflop)', '--equity', { hands: [[48, 49], [44, 45], [40, 36], [0, 5], [1, 9], [2, 30]], board: [], device: 'cpu', threads: 4 }],
  ['Eight-player equity (preflop)', '--equity', { hands: [[48, 49], [44, 45], [40, 36], [0, 5], [1, 9], [2, 30], [3, 31], [20, 24]], board: [], device: 'cpu', threads: 4 }],
  ['Exact action EV, 8-player root (ICM)', '--ev', 'finalTable8', { path: [], hands: [0], method: 'exact', threads: 4, maxVisits: 2000000000, timeLimitMs: 600000 }],
  ['Exact action EV, 8-player after two shoves (ICM)', '--ev', 'finalTable8', { path: [1, 1], hands: [0], method: 'exact', threads: 4, maxVisits: 2000000000, timeLimitMs: 600000 }],
  ['Exact action EV, 2 hands per seat, root range (ICM) [1 run]', '--ev', 'shortStack8', { path: [], hands: [0, 1], range: true, method: 'exact', threads: 4, maxVisits: 2000000000, timeLimitMs: 3600000 }],
  ['Sampled action EV, 8-player (seed 4)', '--ev', 'finalTable8', { path: [1], hands: [0], method: 'sampled', samples: 20000, seed: 4, threads: 4, timeLimitMs: 600000 }],
  ['Large weighted range, heads-up river exact', '--ev', 'huRiver', { path: [], hands: [0, 1, 2, 3, 4, 5], range: true, method: 'exact', threads: 4 }],
  ['Exact response gains, 8 seats, 1 thread', '--gain', 'finalTable8', { method: 'exact', seats: [0, 1, 2, 3, 4, 5, 6, 7], threads: 1, timeLimitMs: 600000 }],
  ['Exact response gains, 8 seats, 4 threads', '--gain', 'finalTable8', { method: 'exact', seats: [0, 1, 2, 3, 4, 5, 6, 7], threads: 4, timeLimitMs: 600000 }],
  ['Restricted response gains, 8 seats (sampled selection)', '--gain', 'finalTable8', { method: 'restricted', selection: 'sampled', samples: 2000, threads: 4, timeLimitMs: 600000 }],
  ['Sampled one-decision gains, 8 seats', '--gain', 'finalTable8', { method: 'sampled', samples: 1500, threads: 4, timeLimitMs: 600000 }],
  ['GPU requested, no usable GPU or budget below request: CPU fallback', '--ev', 'finalTable8', { path: [], hands: [0], method: 'exact', device: 'gpu', gpuMiB: 16, threads: 4, maxVisits: 2000000000, timeLimitMs: 600000 }],
];
const numbers = (mode, j) => !j ? null : mode === '--equity' ? j.shareUnits : mode === '--ev' ? { hands: j.hands.map(h => h.ev), range: j.range && j.range.ev } : j.seats.map(s => s.gain);
for (const [label, mode, a, b] of evalRows) {
  const row = { label, mode }; let args;
  if (mode === '--equity') { const q = path.join(dir, 'q' + report.evaluation.length + '.json'); fs.writeFileSync(q, JSON.stringify(a)); args = [mode, q]; row.request = a; }
  else { const q = path.join(dir, 'q' + report.evaluation.length + '.json'); fs.writeFileSync(q, JSON.stringify(b)); args = [mode, specs[a], evalState[a], q]; row.request = b; row.study = a; }
  const res = {};
  for (const [v, cli] of [['v41', oldCli], ['v42', newCli]]) {
    if (mode !== '--equity' && a !== 'finalTable8' && !fs.existsSync(evalState[a])) exec(cli === newCli ? newCli : newCli, [specs[a], 400, 2, evalState[a], 1024]);
    const times = []; let j = null, err = null;
    const n = /\[1 run\]/.test(label) ? 1 : RUNS;
    for (let r = 0; r < n; r++) { const x = exec(cli, args); if (!x.ok) { err = x.err; break; } times.push(x.s); j = x.json; }
    if (err) { row[v] = { error: err }; continue; }
    const xe = j.execution || {};
    row[v] = { medianSeconds: med(times), minSeconds: Math.min(...times), maxSeconds: Math.max(...times), requestedDevice: xe.requestedDevice || xe.device || (a && a.device) || null, observedDevice: xe.observedDevice || (j.gpuUsed === false ? 'cpu' : null), cpuBoards: xe.cpuBoards ?? null, gpuBoards: xe.gpuBoards ?? null,
      cudaErrors: xe.gpuErrors ? xe.gpuErrors.length : null, gpuNote: xe.gpuNote || j.gpuFallbackReason || null, profileSeconds: xe.profileSeconds || null, distinctInformationSets: j.coverage ? j.coverage.distinctInformationSets : null };
    res[v] = numbers(mode, j);
  }
  row.identicalNumbers = JSON.stringify(res.v41) === JSON.stringify(res.v42); row.numbers = res.v42;
  row.speedup = row.v41 && row.v42 && row.v41.medianSeconds && row.v42.medianSeconds ? row.v41.medianSeconds / row.v42.medianSeconds : null;
  report.evaluation.push(row); console.log('eval ', label.padEnd(66), 'v4.1', row.v41.medianSeconds?.toFixed(3), 'v4.2', row.v42.medianSeconds?.toFixed(3), 'x' + (row.speedup || 0).toFixed(2), 'identical', row.identicalNumbers);
}
report.note = 'Training code is unchanged in 4.2: training rows measure run-to-run noise and must give identical states. Evaluation speed-ups come from the exact pattern projection (exact EVs and exact/restricted best responses); sampled evaluation and equity are expected to be unchanged. Equity rows use device cpu; GPU equity was not measured here (no NVIDIA device).';
fs.writeFileSync(out, JSON.stringify(report, null, 1));
fs.rmSync(dir, { recursive: true, force: true });
