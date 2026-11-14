// EightMax 5.1 (Requirement 2): 5.0 vs 5.1 on the two device-mode workloads of the RTX 4060 Ti report.
//   turn: source/tests/fixtures/device-turn.json, 100 updates, 4 threads, 1024 MiB (= "Compare processing
//         modes.bat": 2,400 sampled deals, not external sampling)
//   es:   source/tests/fixtures/es-six-weighted.json with batchDeals 64, 40 updates, 4 threads, 512 MiB
//         (= the hardware validator's external-sampling batch rows: 2,560 deals)
// For each environment (no CUDA driver; the Linux CUDA test double = SIMULATED driver, not a GPU), mode
// (cpu, auto, gpu, hybrid) and binary, runs are interleaved over --rounds (order rotated per round).
// Records training seconds (the engine's wallSeconds), process seconds (spawn to exit), the state body
// SHA-256 + RNG (must equal CPU Only), the scheduling decision, whether the driver library was loaded and
// cuInit calls (test double statistics), calibrations and GPU-buffer bytes. Reports median, IQR, min, max.
// usage: node tools/devices50.js <out.json> --arm=name:mwcli ... [--fixture-dir=dir-with-libcuda.so.1] [--rounds=9]
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
const args = process.argv.slice(2), out = args.find(a => !a.startsWith('--'));
const opt = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const arms = args.filter(a => a.startsWith('--arm=')).map(a => { const [name, exe] = a.slice(6).split(':'); return { name, exe: path.resolve(exe) }; });
const rounds = +opt('rounds', 9), fixtureDir = opt('fixture-dir', null);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devices51-')), fx = path.join(__dirname, '..', 'tests', 'fixtures');
const body = f => { const b = fs.readFileSync(f), hl = b.readUInt32LE(8); return crypto.createHash('sha256').update(b.subarray(12 + hl)).digest('hex'); };
const workloads = [
  { key: 'turn', name: 'three-player turn, 100 updates x 8 deals x 3 seats = 2,400 deals (Compare processing modes)', spec: JSON.parse(fs.readFileSync(path.join(fx, 'device-turn.json'), 'utf8')), argv: ['100', '4'], mib: '1024' },
  { key: 'es', name: 'six-player weighted external sampling, 40 updates x 64 deals = 2,560 deals (hardware validator)', spec: Object.assign(JSON.parse(fs.readFileSync(path.join(fx, 'es-six-weighted.json'), 'utf8')), { batchDeals: 64 }), argv: ['40', '4'], mib: '512' },
];
// 5.1: the simulated driver as-is, and with controllable costs that make CUDA clearly profitable (EM_TEST_CPU_SCORE_NS) or
// profitable only above a batch size inside the job (crossover near the fixture's batch sizes)
const envs = [{ key: 'no-driver', env: { LD_LIBRARY_PATH: '' } }, ...(fixtureDir ? [{ key: 'test-double', env: { LD_LIBRARY_PATH: fixtureDir } }, { key: 'test-double-gpu-profitable', env: { LD_LIBRARY_PATH: fixtureDir, EM_TEST_CPU_SCORE_NS: '20000' }, turnOnly: true }, { key: 'test-double-crossover', env: { LD_LIBRARY_PATH: fixtureDir, EM_TEST_CPU_SCORE_NS: '20000', EM_FIXTURE_LAUNCH_US: '2860' }, turnOnly: true }] : [])];
const q = (a, p) => { const s = [...a].sort((x, y) => x - y), i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const summary = a => ({ median: q(a, 0.5), iqr: [q(a, 0.25), q(a, 0.75)], min: Math.min(...a), max: Math.max(...a), n: a.length });
const report = { tool: 'devices51', generated: new Date().toISOString(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, rounds, arms, note: 'No physical NVIDIA GPU on this machine. "test-double" is a simulated CUDA driver: it shows whether the driver is initialised and how many calibrations run, not real GPU cost.', results: [] };
for (const w of workloads) for (const e of envs) for (const mode of ['cpu', 'auto', 'gpu', 'hybrid']) {
  if (e.turnOnly && w.key !== 'turn') continue;
  const spec = path.join(dir, w.key + '-' + mode + '.json'); fs.writeFileSync(spec, JSON.stringify({ ...w.spec, device: mode }));
  const rows = arms.map(() => []);
  for (let r = 0; r < rounds; r++) for (let j = 0; j < arms.length; j++) {
    const i = (j + r) % arms.length, st = path.join(dir, 's.state'), stats = path.join(dir, 'stats.json'); try { fs.unlinkSync(stats); } catch {}
    const t0 = process.hrtime.bigint(), x = spawnSync(arms[i].exe, [spec, ...w.argv, st, w.mib], { encoding: 'utf8', env: { ...process.env, ...e.env, EM_FIXTURE_STATS: stats } }), proc = Number(process.hrtime.bigint() - t0) / 1e9;
    if (x.status !== 0) throw new Error(arms[i].name + ' ' + w.key + ' ' + mode + ': ' + x.stderr);
    const info = JSON.parse(x.stdout), drv = fs.existsSync(stats) ? JSON.parse(fs.readFileSync(stats, 'utf8')) : null, sc = info.scheduling || {};
    rows[i].push({ trainingSeconds: info.wallSeconds, processSeconds: proc, body: body(st), rng: info.rng, deals: info.trainingDeals, devicePath: info.devicePath, decision: sc.decision || null, driverLoaded: !!drv, cuInitCalls: drv ? drv.cuInitCalls ?? null : 0, calibrations: sc.calibrationsThisCall ?? info.scoreCalibrations ?? null, calibrationSeconds: sc.calibrationSecondsThisCall ?? null, reuses: sc.calibrationReusesThisCall ?? null, driverInitSeconds: sc.driverInitSecondsThisCall ?? null, gpuBufferPeakBytes: info.gpuBufferPeakBytes });
  }
  for (let i = 0; i < arms.length; i++) {
    const r = rows[i];
    report.results.push({ workload: w.key, environment: e.key, mode, arm: arms[i].name, deals: r[0].deals, trainingSeconds: summary(r.map(x => x.trainingSeconds)), processSeconds: summary(r.map(x => x.processSeconds)),
      stateBody: r[0].body, rng: r[0].rng, consistentAcrossRounds: r.every(x => x.body === r[0].body && x.rng === r[0].rng), devicePath: r[0].devicePath, decision: r[0].decision, driverLoaded: r[0].driverLoaded, cuInitCalls: r[0].cuInitCalls, calibrations: summary(r.map(x => x.calibrations ?? 0)), calibrationReuses: r[0].reuses, calibrationSeconds: r[0].calibrationSeconds == null ? null : summary(r.map(x => x.calibrationSeconds)), driverInitSeconds: r[0].driverInitSeconds == null || r[0].driverInitSeconds < 0 ? null : summary(r.map(x => x.driverInitSeconds)), gpuBufferPeakBytes: r[0].gpuBufferPeakBytes });
  }
}
// parity: every mode, arm and environment reproduces the CPU Only state of the same workload and environment
for (const w of workloads) for (const e of envs) { const ref = report.results.find(x => x.workload === w.key && x.environment === e.key && x.mode === 'cpu'); if (!ref) continue; for (const x of report.results.filter(y => y.workload === w.key && y.environment === e.key)) x.sameStateAsCpuOnly = x.stateBody === ref.stateBody && x.rng === ref.rng; }
fs.writeFileSync(out, JSON.stringify(report, null, 1)); fs.rmSync(dir, { recursive: true, force: true });
for (const x of report.results) console.log(x.workload.padEnd(5), x.environment.padEnd(12), x.mode.padEnd(7), x.arm.padEnd(5), 'train', x.trainingSeconds.median.toFixed(4), '[' + x.trainingSeconds.iqr.map(v => v.toFixed(4)).join(', ') + ']', 'process', x.processSeconds.median.toFixed(4), 'driver', x.driverLoaded ? 'loaded(cuInit ' + x.cuInitCalls + ')' : 'not loaded', 'cal', x.calibrations.median, 'gpuB', x.gpuBufferPeakBytes, x.sameStateAsCpuOnly ? 'SAME' : 'DIFFERENT', (x.decision || x.devicePath).slice(0, 40));
if (report.results.some(x => !x.sameStateAsCpuOnly || !x.consistentAcrossRounds)) process.exit(1);
