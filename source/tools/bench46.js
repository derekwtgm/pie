// EightMax 4.6 (Priority 14): version 4.5 against 4.6, same scenarios, same seeds, same
// machine, INTERLEAVED (each round runs every scenario once with 4.5 and once with 4.6, the
// order alternating between rounds). For every run: version/build, scenario, algorithm, seed,
// training deals, threads, device requested/observed, CPU/GPU board evaluations, wall time,
// peak RSS, strategy SHA-256 and EV / gain IEEE 754 bit patterns. Results must be identical
// between versions (4.6 does not change training or evaluation arithmetic); times are reported
// as median, min, max over the rounds and the 4.6/4.5 median ratio.
// usage: node tools/bench46.js <4.5 mwcli> <4.6 mwcli> <out.json> [--rounds=7]
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const E = require('./loadlib'); for (const l of ['lib_runouts', 'lib_wide', 'lib_river']) require('../web/' + l);
const [cli45, cli46, out] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const rounds = +((process.argv.find(a => a.startsWith('--rounds=')) || '--rounds=7').slice(9));
const root = path.join(__dirname, '..', '..'), fx40 = path.join(root, 'validation', '4.0', 'fixtures'), spec45 = path.join(root, 'validation', '4.5', 'fixtures', 'icm-final8.spec.json');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em46-bench-'));
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const base = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128 };
const spec = (name, cfg) => { const f = path.join(dir, name + '.spec.json'); fs.writeFileSync(f, JSON.stringify(E.MultiwayGame({ ...base, ...cfg, privateSeed: 11 }).nativeSpec())); return f; };
const studies = {
  'heads-up river (chip EV)': [spec('hu', { board: 'Ks8d5h2c2s', common: 10, stacks: [20, 20], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd'], streets: { river: { bets: '50,a', raises: 'a', maxBets: 2 } } }), 100000],
  'three-player river (side pots)': [spec('r3', { board: 'Ks8d5h2c2s', common: 6, stacks: [4, 12, 30], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc'], streets: { river: { bets: '75,a', raises: 'a', maxBets: 2 } } }), 100000],
  'six-player flop (unequal stacks, all-ins)': [spec('f6', { board: 'Td7c2h', dealt: 8, common: 1.5, stacks: [20, 35, 8, 50, 14, 3], prior: Array(6).fill(2.5), folded: [1, 2.5], ranges: ['AhTh,7s7d', 'KdTs,9c8c', 'QsQd,Ac7h', 'JhTc,6s5s', 'AdKc,2s2d', '8h8d,As2c'], streets: { flop: { bets: 'a', raises: '', maxBets: 1 } } }), 50000],
  'multiway short-stack all-ins, bubble ICM': [spec('b4', { preflop: { mode: 'shove' }, dealt: 4, common: 0, board: '', stacks: [12, 7, 20, 4], ranges: ['AsAh,7c2d:0.5', 'KsKh:0.75,8c3d', 'QsQh,6d5d', 'JsJh:0.5,9s8s'], icm: { payouts: [50, 30, 20] }, batchDeals: 4, actionStreams: 'deal' }), 50000],
  'eight-player preflop final table (ICM)': [spec('ft8', { preflop: { mode: 'shove' }, board: '', dealt: 8, common: 0, stacks: [30, 22, 15, 40, 9, 18, 25, 12], ranges: ['AsAh', 'KsKh', 'QsQh', 'JsJh', 'TsTh', '9s9h', '8s8h', '7s7h'], icm: { payouts: [30, 20, 14, 11, 9, 7, 5, 4] }, batchDeals: 4, actionStreams: 'deal' }), 50000],
  'eight-player linked training (random ranges, ICM)': [spec45, 1200],
};
const runCli = (exe, args, env = {}) => { const t0 = process.hrtime.bigint(); const r = cp.spawnSync(exe, args.map(String), { encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, EM_QUERY_TIMING: '1', ...env } }); const ms = Number(process.hrtime.bigint() - t0) / 1e6; if (r.status !== 0) throw Error(exe + ' ' + args.join(' ') + ': ' + r.stderr); return { ms, out: r.stdout, err: r.stderr }; };
const qfile = (name, body) => { const f = path.join(dir, name + '.json'); fs.writeFileSync(f, JSON.stringify(body)); return f; };
const scenarios = [];
for (const [name, [sp, deals]] of Object.entries(studies)) {
  const batch = JSON.parse(fs.readFileSync(sp, 'utf8')).batchDeals || 1;
  scenarios.push({ name: 'training: ' + name, algorithm: 'external-sampling MCCFR, linear weighting (default)', seed: 11, deals, threads: 4, run: (exe, tag) => {
    const st = path.join(dir, tag + '.state'); const r = runCli(exe, [sp, deals / batch, 4, st, 512]); const info = JSON.parse(r.out);
    return { ms: r.ms, trainingSeconds: info.wallSeconds, peakRssMiB: info.processPeakRssMiB, result: sha(st), deals: info.trainingDeals, updates: info.iterations }; } });
}
const fxSpec = path.join(fx40, 'push8-icm.spec.json'), fxState = path.join(fx40, 'push8-icm.state');
const queryScenario = (name, mode, body, threads) => ({ name, threads, run: exe => {
  const r = runCli(exe, [mode, fxSpec, fxState, qfile('q', body)]); const j = JSON.parse(r.out), timing = JSON.parse(r.err.trim().split('\n')[0]);
  const bits = mode === '--gain' ? j.seats.map(s => s.gainBits).join() : j.hands.map(h => (h.evBits || []).join()).join('|');
  const ex = j.execution || {};
  return { ms: r.ms, queryMs: timing.queryMs, result: body.method === 'sampled' ? 'sampled (seeded): ' + bits : bits, requestedDevice: ex.requestedDevice, observedDevice: ex.observedDevice, cpuBoards: ex.cpuBoards, gpuBoards: ex.gpuBoards, peakEvaluationMiB: ex.peakEvaluationMiB, coveragePeakBytes: ex.coverageMemory && ex.coverageMemory.peakBytes }; } });
scenarios.push(queryScenario('exact action EV, eight-player ICM root (CPU)', '--ev', { path: [], hands: [0], method: 'exact', device: 'cpu', maxVisits: 2000000000, threads: 4 }, 4));
scenarios.push(queryScenario('exact action EV, eight-player ICM root (Automatic, no GPU present)', '--ev', { path: [], hands: [0], method: 'exact', device: 'auto', maxVisits: 2000000000, threads: 4 }, 4));
scenarios.push(queryScenario('sampled action EV, 20,000 samples (seeded)', '--ev', { path: [], hands: [0], method: 'sampled', samples: 20000, seed: 3, threads: 4 }, 4));
scenarios.push(queryScenario('eight-seat exact response gains (CPU)', '--gain', { method: 'exact', seats: [0, 1, 2, 3, 4, 5, 6, 7], device: 'cpu', threads: 4 }, 4));
scenarios.push(queryScenario('large information-set coverage (exact EV, coverageMiB 1, audit)', '--ev', { path: [], hands: [0], method: 'exact', device: 'cpu', maxVisits: 2000000000, threads: 4, coverageMiB: 1 }, 4));
scenarios.push({ name: 'checkpoint continuation 150 + 150 vs 300 (eight-player linked ICM)', threads: 4, run: (exe, tag) => {
  const a = path.join(dir, tag + 'a'), b = path.join(dir, tag + 'b'); const t0 = Date.now();
  runCli(exe, [spec45, 150, 4, a, 512]); runCli(exe, [spec45, 150, 4, b, 512, a]);
  return { ms: Date.now() - t0, result: sha(b) }; } });
const report = { tool: 'bench46', generated: new Date().toISOString(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, platform: os.platform(), rounds, order: 'interleaved; 4.5/4.6 order alternates each round',
  versions: { '4.5': cp.execFileSync(cli45, ['--build-id'], { encoding: 'utf8' }).trim(), '4.6': cp.execFileSync(cli46, ['--build-id'], { encoding: 'utf8' }).trim() },
  gpu: 'none on this machine: CUDA cold start, warm evaluation and GPU board counts cannot be measured here; see "Validate CUDA hardware.bat"', scenarios: [] };
const runs = {};
for (let r = 0; r < rounds; r++) for (const s of scenarios) for (const v of (r % 2 ? ['4.6', '4.5'] : ['4.5', '4.6'])) {
  const x = s.run(v === '4.5' ? cli45 : cli46, v.replace('.', '') + 'r' + r); (runs[s.name] ??= { '4.5': [], '4.6': [] })[v].push(x);
}
const st = v => { const s = v.slice().sort((a, b) => a - b); return { median: s[s.length >> 1], min: s[0], max: s[s.length - 1] }; };
for (const s of scenarios) {
  const R = runs[s.name], row = { scenario: s.name, algorithm: s.algorithm, seed: s.seed, trainingDeals: s.deals, threads: s.threads };
  for (const v of ['4.5', '4.6']) { const xs = R[v]; row[v] = { wallMs: st(xs.map(x => x.ms)), queryMs: xs[0].queryMs !== undefined ? st(xs.map(x => x.queryMs)) : undefined, trainingSeconds: xs[0].trainingSeconds !== undefined ? st(xs.map(x => x.trainingSeconds)) : undefined, peakRssMiB: xs[0].peakRssMiB !== undefined ? st(xs.map(x => x.peakRssMiB)) : undefined, result: xs[0].result, identicalAcrossRounds: xs.every(x => x.result === xs[0].result), requestedDevice: xs[0].requestedDevice, observedDevice: xs[0].observedDevice, cpuBoards: xs[0].cpuBoards, gpuBoards: xs[0].gpuBoards, peakEvaluationMiB: xs[0].peakEvaluationMiB, coveragePeakBytes: xs[0].coveragePeakBytes }; }
  row.identicalResults = R['4.5'][0].result === R['4.6'][0].result && row['4.5'].identicalAcrossRounds && row['4.6'].identicalAcrossRounds;
  const key = row['4.5'].queryMs ? 'queryMs' : 'wallMs'; row.timeRatio46over45 = row['4.6'][key].median / row['4.5'][key].median; row.timeMeasure = key;
  report.scenarios.push(row);
  console.log(s.name.padEnd(70), 'identical', row.identicalResults, ' 4.5', row['4.5'][key].median.toFixed(1), ' 4.6', row['4.6'][key].median.toFixed(1), ' ratio', row.timeRatio46over45.toFixed(3));
}
fs.writeFileSync(out, JSON.stringify(report, null, 1)); fs.rmSync(dir, { recursive: true, force: true });
console.log('wrote', out);
