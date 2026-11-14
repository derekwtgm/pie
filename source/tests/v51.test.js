'use strict';
// EightMax 5.1 regression tests, part 1: CUDA route-measurement reuse in GPU Preferred and Hybrid.
// 5.0 re-measured every new batch size (96 calibrations on the 100-update three-player turn of "Compare
// processing modes"; 7.6 ms GPU Preferred / 10.9 ms Hybrid on an RTX 4060 Ti). 5.1 reuses a measurement for
// nearby batch sizes inside a window derived from an affine device-cost model (native/route_reuse.hpp).
// The CUDA test double (a SIMULATED driver) gets controllable costs: EM_FIXTURE_LAUNCH_US (fixed device
// cost per launch) and EM_TEST_CPU_SCORE_NS (CPU cost per scored unit, test-only), so a device route can be
// made clearly profitable, clearly unprofitable, or profitable only above a batch size inside one job.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const build = require('./native_build');
const tool = () => process.env.EM_TEST_MWCLI || build.cli().cli;
const fixtureDir = () => build.cli().fixtureDir;
const win = process.platform === 'win32';
const driverEnv = () => win ? { EM_TEST_CUDA_LIBRARY: process.env.EM_TEST_CUDA_FIXTURE } : { LD_LIBRARY_PATH: fixtureDir() };
const skip = (!tool() && (build.cli().why || 'no native CLI')) || (win ? (!process.env.EM_TEST_CUDA_FIXTURE && 'Windows: set EM_TEST_CUDA_FIXTURE to the CUDA test-double DLL (the CI workflow builds it)') : process.platform !== 'linux' ? 'needs the Linux or Windows CUDA test double' : (!fixtureDir() && 'no CUDA test double'));
const cxx = process.env.EM_TEST_CXX || 'g++';
const native = path.join(__dirname, '..', 'native'), fixtures = path.join(__dirname, 'fixtures');
const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'em51-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const bodySha = f => { const b = fs.readFileSync(f), hl = b.readUInt32LE(8); return crypto.createHash('sha256').update(b.subarray(12 + hl)).digest('hex'); };
function trainWith(dir, specFile, device, updates, threads, mib, env = {}) {
  const s = JSON.parse(fs.readFileSync(specFile, 'utf8')); s.device = device;
  const tag = crypto.randomBytes(3).toString('hex'), spec = path.join(dir, device + tag + '.json'), state = path.join(dir, device + tag + '.state'), stats = path.join(dir, 'stats' + tag + '.json'), trace = path.join(dir, 'trace' + tag + '.txt');
  fs.writeFileSync(spec, JSON.stringify(s));
  const r = cp.spawnSync(tool(), [spec, updates, threads, state, mib], { encoding: 'utf8', env: { ...process.env, ...driverEnv(), EM_FIXTURE_STATS: stats, EM_TEST_ROUTE_TRACE: trace, ...env }, timeout: 600000 });
  assert.equal(r.status, 0, r.stderr);
  const rows = fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(l => { const [u, route, measured] = l.split(' ').map(Number); return { u, route, measured }; }) : [];
  return { info: JSON.parse(r.stdout), body: bodySha(state), driver: fs.existsSync(stats) ? JSON.parse(fs.readFileSync(stats, 'utf8')) : null, trace: rows };
}
const TURN = path.join(fixtures, 'device-turn.json'), ES6 = path.join(fixtures, 'es-six-weighted.json');
const parity = (r, cpu, label) => { assert.equal(r.body, cpu.body, label + ': strategy bytes'); assert.equal(r.info.rng, cpu.info.rng, label + ': RNG'); assert.equal(r.info.trainingDeals, cpu.info.trainingDeals, label + ': deals'); assert.equal(r.info.stateVisits, cpu.info.stateVisits, label + ': visits'); assert.equal(r.info.iterations, cpu.info.iterations, label + ': updates'); };

test('5.1 route rule: reused decisions equal exact measurements under an affine cost model (tests/route51.cpp)', { skip: (win && !process.env.EM_TEST_CXX) ? 'needs EM_TEST_CXX on Windows' : false, timeout: 300000 }, t => {
  const dir = tmp(t), exe = path.join(dir, 'route51' + (win ? '.exe' : ''));
  cp.execFileSync(cxx, ['-std=c++20', '-O2', '-Wall', '-Wextra', '-Werror', '-I' + native, path.join(__dirname, 'route51.cpp'), '-o', exe, ...(win ? ['-static'] : [])], { stdio: 'pipe' });
  const r = cp.spawnSync(exe, [], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stdout + r.stderr);
  const j = JSON.parse(r.stdout); assert.equal(j.wrongReusedDecisions, 0); assert.ok(j.reused > 10 * j.measured, JSON.stringify(j)); assert.ok(j.routeSwitches > 0); assert.equal(j.windows, true); assert.equal(j.exactMode, true);
});
test('5.1 original device fixture (2,400-deal turn): GPU Preferred and Hybrid measure once instead of once per batch size; same strategy, RNG and counters as CPU Only', { skip, timeout: 600000 }, t => {
  const dir = tmp(t), cpu = trainWith(dir, TURN, 'cpu', 100, 4, 1024);
  for (const mode of ['gpu', 'hybrid']) {
    const r = trainWith(dir, TURN, mode, 100, 4, 1024), exact = trainWith(dir, TURN, mode, 100, 4, 1024, { EM_ROUTE_REUSE: '0' });
    const sc = r.info.scheduling, se = exact.info.scheduling;
    assert.ok(r.driver && r.driver.cuInitCalls >= 1, mode + ': explicit modes still open and probe CUDA'); assert.equal(sc.cudaOpenedThisCall, true);
    // How many measurements the reuse rule needs depends on the measured CPU/device ratio (wall clock), so the
    // count itself is machine-dependent (1 on the development machine, 5 on a GitHub runner where the simulated
    // device and the CPU are closer and a CPU record is not extended above its own size). Timing-independent
    // checks instead: every measurement after the first lies outside the window that the rule guarantees for
    // every earlier measurement (CPU route: at least [u0/4, u0]; device route: at least [u0, 2 u0]), so no
    // measurement is ever repeated where a reuse was allowed, and the count stays far below one per batch.
    const ms = r.trace.filter(x => x.measured), covered = (u, m) => m.route === 0 ? (u >= m.u / 4 && u <= m.u) : (u >= m.u && u <= 2 * m.u);
    ms.forEach((m, i) => { for (const e of ms.slice(0, i)) assert.ok(!covered(m.u, e), mode + ': measured ' + m.u + ' although the measurement at ' + e.u + ' (route ' + e.route + ') covers it'); });
    assert.ok(sc.calibrationsThisCall >= 1 && sc.calibrationsThisCall <= 16, mode + ': calibrations ' + sc.calibrationsThisCall);
    assert.ok(se.calibrationsThisCall > 2 * sc.calibrationsThisCall && se.calibrationsThisCall > 10, mode + ': exact-size reuse measures ' + se.calibrationsThisCall + ', nearby ' + sc.calibrationsThisCall);
    assert.equal(sc.batchesScored, 100); assert.equal(sc.calibrationsThisCall + sc.calibrationReusesThisCall, 100);
    assert.ok(sc.batchUnitsMax > sc.batchUnitsMin, 'variable batch sizes'); assert.equal(sc.routeReuseRule, '5.1 nearby batch sizes'); assert.equal(se.routeReuseRule, '5.0 exact batch size');
    assert.equal(sc.recalibrationReasons['first measurement in this job'], 1);
    assert.ok(sc.driverInitSecondsThisCall >= 0 && sc.scoringSecondsThisCall > 0 && sc.deviceTransferAndKernelSecondsThisCall >= 0);
    assert.equal(r.trace.length, 100); assert.equal(r.trace.filter(x => x.measured).length, sc.calibrationsThisCall);
    parity(r, cpu, mode); parity(exact, cpu, mode + ' exact');
  }
});
test('5.1 clearly GPU-profitable fixture: GPU Preferred uses CUDA and Hybrid a split for every batch after one measurement; same state as CPU Only', { skip, timeout: 600000 }, t => {
  const dir = tmp(t), env = { EM_TEST_CPU_SCORE_NS: '20000' }, cpu = trainWith(dir, TURN, 'cpu', 40, 4, 1024, env);
  const g = trainWith(dir, TURN, 'gpu', 40, 4, 1024, env), h = trainWith(dir, TURN, 'hybrid', 40, 4, 1024, env);
  assert.equal(g.info.scheduling.decision, 'CUDA'); assert.ok(g.trace.every(x => x.route === 1), 'every batch on CUDA');
  assert.equal(h.info.scheduling.decision, 'Hybrid'); assert.ok(h.trace.every(x => x.route >= 2), 'every batch split');
  for (const r of [g, h]) { assert.ok(r.info.scheduling.calibrationsThisCall <= 3, 'calibrations ' + r.info.scheduling.calibrationsThisCall); assert.ok(r.info.scheduling.gpuBufferPeakBytesThisCall > 0); }
  parity(g, cpu, 'gpu'); parity(h, cpu, 'hybrid');
});
test('5.1 clearly CPU-profitable fixture (2 ms device overhead per launch): one measurement, every batch on the CPU, same state', { skip, timeout: 600000 }, t => {
  const dir = tmp(t), env = { EM_FIXTURE_LAUNCH_US: '2000' }, cpu = trainWith(dir, TURN, 'cpu', 60, 4, 1024, env);
  for (const mode of ['gpu', 'hybrid']) {
    const r = trainWith(dir, TURN, mode, 60, 4, 1024, env);
    assert.equal(r.info.scheduling.decision, 'CPU after measuring CUDA'); assert.ok(r.trace.every(x => x.route === 0));
    assert.ok(r.info.scheduling.calibrationsThisCall <= 2, mode + ' calibrations ' + r.info.scheduling.calibrationsThisCall); parity(r, cpu, mode);
  }
});
test('5.1 crossover inside one job: the profitable route changes with the batch size and GPU Preferred switches (CPU for small batches, CUDA for large), with few measurements', { skip, timeout: 600000 }, t => {
  // CPU 20 us per unit, device 2.86 ms per launch: the 90% rule crosses near 159 units, inside the
  // fixture's 145-173 batch sizes. Timing-based, so a 6% band around the crossover is not judged.
  const dir = tmp(t), env = { EM_TEST_CPU_SCORE_NS: '20000', EM_FIXTURE_LAUNCH_US: '2860' }, cpu = trainWith(dir, TURN, 'cpu', 100, 4, 1024, env);
  const r = trainWith(dir, TURN, 'gpu', 100, 4, 1024, env);
  const onCpu = r.trace.filter(x => x.route === 0), onGpu = r.trace.filter(x => x.route === 1);
  assert.ok(onCpu.length > 0 && onGpu.length > 0, 'both routes used: cpu ' + onCpu.length + ', gpu ' + onGpu.length);
  const maxCpu = Math.max(...onCpu.map(x => x.u)), minGpu = Math.min(...onGpu.map(x => x.u));
  assert.ok(maxCpu <= minGpu * 1.06, 'small batches on the CPU, large on CUDA: largest CPU batch ' + maxCpu + ', smallest CUDA batch ' + minGpu);
  assert.ok(r.info.scheduling.calibrationsThisCall < 20, 'measurements ' + r.info.scheduling.calibrationsThisCall);
  assert.ok(Object.keys(r.info.scheduling.recalibrationReasons).length >= 1);
  parity(r, cpu, 'gpu');
});
test('5.1 external sampling (2,560 deals, six players): GPU Preferred and Hybrid keep parity; Automatic still skips CUDA', { skip, timeout: 600000 }, t => {
  const dir = tmp(t), es = path.join(dir, 'es.json'); fs.writeFileSync(es, JSON.stringify({ ...JSON.parse(fs.readFileSync(ES6, 'utf8')), batchDeals: 64 }));
  const cpu = trainWith(dir, es, 'cpu', 40, 4, 512), auto = trainWith(dir, es, 'auto', 40, 4, 512);
  assert.equal(auto.driver, null); assert.equal(auto.info.scheduling.calibrationsThisCall, 0); parity(auto, cpu, 'auto');
  for (const mode of ['gpu', 'hybrid']) { const r = trainWith(dir, es, mode, 40, 4, 512); parity(r, cpu, mode); assert.ok(r.info.scheduling.calibrationsThisCall <= r.info.scheduling.batchesScored); }
});
test('5.1 a device fault after measurements were reused falls back to the CPU with the same state', { skip, timeout: 600000 }, t => {
  const dir = tmp(t), env = { EM_TEST_CPU_SCORE_NS: '20000' }, cpu = trainWith(dir, TURN, 'cpu', 30, 4, 1024, env);
  for (const fault of ['launch', 'download', 'mismatch']) { const r = trainWith(dir, TURN, 'gpu', 30, 4, 1024, { ...env, EM_FIXTURE_FAULT: fault }); parity(r, cpu, fault); assert.match(r.info.devicePath, /CPU/, fault); }
});

// ============ part 2: deterministic continuation with the 5.1 batch-size warm-up schedule ============
// Persistent state that determines future updates (all in the checkpoint or the spec): regret and
// average-strategy tables, deal RNG, per-deal action seed (actionStreams "deal": derived from the
// actionSeed, the committed update count and the deal index), committed updates, committed deals, state
// visits, and the schedule (start, doubleEvery, batchDeals in the spec; the position in it is the committed
// update count). No wall-clock measurement enters a training decision. Thread count does not change bits.
const cliSkip = !tool() && (build.cli().why || 'no native CLI');
const V51 = path.join(__dirname, '..', '..', 'validation', '5.1', 'fixtures');
const run = (a, env = {}) => cp.spawnSync(tool(), a.map(String), { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 600000, maxBuffer: 64 << 20 });
const fileSha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const schedSpec = (dir, extra = {}) => { const s = { ...JSON.parse(fs.readFileSync(ES6, 'utf8')), batchDeals: 16, batchSchedule: { start: 2, doubleEvery: 5 }, ...extra }, f = path.join(dir, 'sched-' + crypto.randomBytes(3).toString('hex') + '.json'); fs.writeFileSync(f, JSON.stringify(s)); return f; };
// committed deals after t updates for start 2, doubleEvery 5, max 16: 2,4,8,16,16,...
const dealsAfter = t => { let d = 0; for (let i = 0; i < Math.min(t, 15); i++) d += 2 << Math.floor(i / 5); return d + Math.max(0, t - 15) * 16; };
const train = (spec, updates, threads, out, from, env) => { const r = run([spec, updates, threads, out, 512, ...(from ? [from] : [])], env); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };
const sameRun = (a, b, label) => { for (const k of ['iterations', 'trainingDeals', 'stateVisits', 'rng', 'actionRng', 'rows', 'states']) assert.equal(a[k], b[k], label + ': ' + k); assert.deepEqual(a.batchSchedule, b.batchSchedule, label + ': schedule state'); };

test('5.1 warm-up schedule: committed deals follow the schedule; the report shows the next batch size', { skip: cliSkip, timeout: 600000 }, t => {
  const dir = tmp(t), spec = schedSpec(dir);
  for (const u of [1, 4, 5, 6, 14, 15, 16, 22]) { const info = train(spec, u, 2, path.join(dir, 'x.state')); assert.equal(info.iterations, u); assert.equal(info.trainingDeals, dealsAfter(u), 'deals after ' + u); assert.equal(info.batchSchedule.nextBatchDeals, u >= 15 ? 16 : 2 << Math.floor(u / 5)); }
  const bad = run([schedSpec(dir, { actionStreams: 'shared' }), 1, 1, path.join(dir, 'y.state'), 512]); assert.notEqual(bad.status, 0); assert.match(bad.stderr, /batchSchedule needs external sampling with per-deal action streams/);
  const big = run([schedSpec(dir, { batchSchedule: { start: 32, doubleEvery: 5 } }), 1, 1, path.join(dir, 'y.state'), 512]); assert.notEqual(big.status, 0); assert.match(big.stderr, /exceeds batchDeals/);
  const one = run([schedSpec(dir, { batchSchedule: { start: 1, doubleEvery: 5 } }), 1, 1, path.join(dir, 'y.state'), 512]); assert.notEqual(one.status, 0); assert.match(one.stderr, /at least 2/);
  const dc = run([schedSpec(dir, { weighting: 'dcfr' }), 1, 1, path.join(dir, 'y.state'), 512]); assert.notEqual(dc.status, 0); assert.match(dc.stderr, /DCFR/);
});
test('5.1 warm-up schedule: deal weighting - a schedule that starts at the full batch reproduces the fixed batch byte for byte (5.0 parallel64 unchanged)', { skip: cliSkip, timeout: 600000 }, t => {
  const dir = tmp(t), fixedSpec = schedSpec(dir, { batchDeals: 16, batchSchedule: undefined }), full = schedSpec(dir, { batchDeals: 16, batchSchedule: { start: 16, doubleEvery: 3 } });
  const a = path.join(dir, 'a.state'), b = path.join(dir, 'b.state'); train(fixedSpec, 30, 4, a); train(full, 30, 2, b);
  const body = f => { const x = fs.readFileSync(f), hl = x.readUInt32LE(8); return crypto.createHash('sha256').update(x.subarray(12 + hl)).digest('hex'); };
  assert.equal(body(a), body(b), 'same tables, RNG and counters');
});
test('5.1 warm-up schedule: save and resume before, at and after every batch-size transition, short final calls, 1 vs 4 workers, raw and EMZ1 = uninterrupted', { skip: cliSkip, timeout: 900000 }, t => {
  const dir = tmp(t), spec = schedSpec(dir), ref = path.join(dir, 'ref.state'), full = train(spec, 24, 4, ref), refSha = fileSha(ref);
  assert.equal(full.trainingDeals, dealsAfter(24));
  for (const cut of [4, 5, 6, 9, 10, 11, 14, 15, 16, 23]) for (const threads of [1, 4]) {
    const a = path.join(dir, 'a' + cut + '.state'), b = path.join(dir, 'b' + cut + '-' + threads + '.state');
    train(spec, cut, threads, a); const info = train(spec, 24 - cut, 5 - threads, b, a);
    assert.equal(fileSha(b), refSha, 'resume after ' + cut + ' updates (' + threads + ' then ' + (5 - threads) + ' workers)'); sameRun(info, full, 'cut ' + cut);
    if (threads === 1) { const z = a + '.emz'; assert.equal(run(['--compress', a, z]).status, 0); const c = path.join(dir, 'c' + cut + '.state'); train(spec, 24 - cut, 4, c, z); assert.equal(fileSha(c), refSha, 'resume from EMZ1 after ' + cut); }
  }
  // many short calls (1 update each, the last ones a single short batch) = uninterrupted
  let prev = null; for (let i = 0; i < 24; i++) { const s = path.join(dir, 'g' + i + '.state'); train(spec, 1, 1 + (i % 4), s, prev); prev = s; }
  assert.equal(fileSha(prev), refSha, '24 one-update calls');
});
test('5.1 warm-up schedule: cancellation and a memory-budget stop during an uncommitted batch keep exactly the committed updates; continuing from them = uninterrupted', { skip: cliSkip, timeout: 900000 }, t => {
  const dir = tmp(t), spec = schedSpec(dir);
  const c = path.join(dir, 'c.state'), info = train(spec, 9000000, 4, c, null, { EM_TRAIN_CANCEL_AFTER_MS: '300' });
  assert.equal(info.cancelled, true); assert.equal(info.trainingDeals, dealsAfter(info.iterations), 'committed deals match the committed updates');
  const r = path.join(dir, 'r.state'); train(spec, info.iterations, 2, r); assert.equal(fileSha(c), fileSha(r), 'cancelled at ' + info.iterations + ' = uninterrupted');
  const c2 = path.join(dir, 'c2.state'), r2 = path.join(dir, 'r2.state'); train(spec, 7, 4, c2, c); train(spec, info.iterations + 7, 4, r2); assert.equal(fileSha(c2), fileSha(r2), 'continuation after a cancellation');
  // memory-budget stop: a table budget that runs out part-way; the update in progress is discarded
  const m = path.join(dir, 'm.state'), mr = run([spec, 100000, 2, m, 3]); assert.equal(mr.status, 0, mr.stderr); const mi = JSON.parse(mr.stdout);
  assert.equal(mi.limitReached, true, 'the 3 MiB budget stops training'); assert.ok(mi.iterations > 15, 'the stop comes after the schedule reached its full batch (' + mi.iterations + ' updates)'); assert.equal(mi.trainingDeals, dealsAfter(mi.iterations));
  const mref = path.join(dir, 'mref.state'); train(spec, mi.iterations, 2, mref);
  assert.equal(train(spec, 0, 1, path.join(dir, 'm0.state'), m).iterations, mi.iterations, 'the stopped checkpoint restores');
  assert.equal(fileSha(m), fileSha(mref), 'memory stop at ' + mi.iterations + ' updates = uninterrupted with the same committed updates (tables, RNG, counters)');
  const mc = path.join(dir, 'mc.state'), mcr = path.join(dir, 'mcr.state'); train(spec, 5, 2, mc, m); train(spec, mi.iterations + 5, 2, mcr); assert.equal(fileSha(mc), fileSha(mcr), 'continuation after the memory stop with a larger budget');
});
test('5.1 checkpoints written by 4.9 and 5.0 (raw and EMZ1) resume to the uninterrupted state', { skip: cliSkip, timeout: 600000 }, t => {
  const dir = tmp(t), icm = path.join(V51, 'icm-final8.spec.json'), es = path.join(V51, 'es6w-b64.spec.json');
  const GOLDEN = 'aa80974199182afa91d5a47166d32af0eb00ecff3ba334593eb5a359cc2e22b8';
  for (const f of [path.join(V51, 'v50-icm-150.state'), path.join(V51, 'v50-icm-150.emz'), path.join(__dirname, '..', '..', 'validation', '5.0', 'fixtures', 'v49-150.state'), path.join(__dirname, '..', '..', 'validation', '5.0', 'fixtures', 'v49-150.emz')]) {
    const o = path.join(dir, path.basename(f) + '.out'); train(icm, 150, 4, o, f); assert.equal(fileSha(o), GOLDEN, path.basename(f));
  }
  const ref = path.join(dir, 'es120.state'); train(es, 120, 4, ref);
  for (const f of ['v50-es6w-60.state', 'v50-es6w-60.emz']) { const o = path.join(dir, f + '.out'); train(es, 60, 2, o, path.join(V51, f)); assert.equal(fileSha(o), fileSha(ref), f + ' (external sampling, batch 64, written by 5.0)'); }
  assert.equal(fileSha(ref).slice(0, 16), 'd7821ad671345443', 'the 5.0 uninterrupted 120-update state (5.1 training is unchanged without a schedule)');
});
test('5.1 a checkpoint is refused when the schedule in the spec does not match its committed deals', { skip: cliSkip, timeout: 300000 }, t => {
  const dir = tmp(t), a = path.join(dir, 'a.state'); train(schedSpec(dir), 12, 2, a);
  const other = run([schedSpec(dir, { batchSchedule: { start: 4, doubleEvery: 5 } }), 1, 1, path.join(dir, 'b.state'), 512, a]); assert.notEqual(other.status, 0); assert.match(other.stderr, /Inconsistent/);
  assert.ok(!fs.existsSync(path.join(dir, 'b.state')), 'nothing written');
  const none = run([schedSpec(dir, { batchSchedule: undefined }), 1, 1, path.join(dir, 'c.state'), 512, a]); assert.notEqual(none.status, 0);
});
