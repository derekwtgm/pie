'use strict';
// EightMax 5.0 regression tests: Automatic scheduling on BOTH training paths.
// 4.9 applied the Automatic small-job rule only on the external-sampling path (es::train set
// plannedUpdates); mw_train's other path (sampled deals with simultaneous, alternating or enumerated
// updates - the three-player turn of "Compare processing modes.bat") left plannedUpdates at 0, so
// Automatic opened CUDA, calibrated and then chose the CPU (RTX 4060 Ti report: 63 ms CPU Only vs
// 168 ms Automatic). The Linux CUDA test double (tests/cuda_driver_fixture.cpp, a SIMULATED driver)
// counts cuInit calls and writes EM_FIXTURE_STATS only when the library is loaded, so these tests
// distinguish "never opened" from "opened and fell back" without any timing assertion.
// Test 1 fails with the 4.9 binary (validation/5.0/scheduling/v50-on-4.9.tap).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const build = require('./native_build');
const tool = () => process.env.EM_TEST_MWCLI || build.cli().cli;
const fixtureDir = () => build.cli().fixtureDir;
// Linux: the test double is libcuda.so.1 in the test build cache (LD_LIBRARY_PATH). Windows (5.0): CI builds
// tests/cuda_driver_fixture.cpp as a DLL with the release compiler and passes its absolute path in
// EM_TEST_CUDA_FIXTURE; the engine loads it through the EM_TEST_CUDA_LIBRARY test hook.
const win = process.platform === 'win32';
const driverEnv = () => win ? { EM_TEST_CUDA_LIBRARY: process.env.EM_TEST_CUDA_FIXTURE } : { LD_LIBRARY_PATH: fixtureDir() };
const skip = (!tool() && (build.cli().why || 'no native CLI')) || (win ? (!process.env.EM_TEST_CUDA_FIXTURE && 'Windows: set EM_TEST_CUDA_FIXTURE to the CUDA test-double DLL (the CI workflow builds it)') : process.platform !== 'linux' ? 'needs the Linux or Windows CUDA test double' : (!fixtureDir() && 'no CUDA test double'));
const cxx = process.env.EM_TEST_CXX || 'g++', cc = process.env.EM_TEST_CC || 'gcc';
const native = path.join(__dirname, '..', 'native'), fixtures = path.join(__dirname, 'fixtures');
const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'em50-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const bodySha = f => { const b = fs.readFileSync(f), hl = b.readUInt32LE(8); return crypto.createHash('sha256').update(b.subarray(12 + hl)).digest('hex'); };
// one training process against the test double; returns the report, the state body hash and the driver statistics (null = library never loaded)
function trainWith(dir, specFile, device, updates, threads, mib, env = {}) {
  const s = JSON.parse(fs.readFileSync(specFile, 'utf8')); s.device = device;
  const spec = path.join(dir, device + '.json'), state = path.join(dir, device + '-' + crypto.randomBytes(3).toString('hex') + '.state'), stats = path.join(dir, 'stats-' + crypto.randomBytes(3).toString('hex') + '.json');
  fs.writeFileSync(spec, JSON.stringify(s));
  const r = cp.spawnSync(tool(), [spec, updates, threads, state, mib], { encoding: 'utf8', env: { ...process.env, ...driverEnv(), EM_FIXTURE_STATS: stats, ...env }, timeout: 600000 });
  assert.equal(r.status, 0, r.stderr);
  return { info: JSON.parse(r.stdout), body: bodySha(state), driver: fs.existsSync(stats) ? JSON.parse(fs.readFileSync(stats, 'utf8')) : null };
}
const TURN = path.join(fixtures, 'device-turn.json'), ES6 = path.join(fixtures, 'es-six-weighted.json');

test('5.0 Automatic never opens CUDA for the three-player turn of "Compare processing modes" (2,400 deals, below the threshold): no driver load, 0 calibrations, 0 GPU bytes, same state as CPU Only', { skip, timeout: 600000 }, t => {
  const dir = tmp(t), cpu = trainWith(dir, TURN, 'cpu', 100, 4, 1024), auto = trainWith(dir, TURN, 'auto', 100, 4, 1024);
  assert.equal(cpu.info.trainingDeals, 2400);
  assert.equal(auto.driver, null, 'the CUDA driver library must not be loaded (4.9: cuInit ' + (auto.driver && auto.driver.cuInitCalls) + ')');
  const sc = auto.info.scheduling; assert.ok(sc, 'scheduling block in the report');
  assert.equal(sc.cudaOpenedThisCall, false); assert.equal(sc.automaticSkippedCuda, true); assert.equal(sc.calibrationsThisCall, 0); assert.equal(sc.gpuBufferPeakBytesThisCall, 0);
  assert.equal(auto.info.gpuBufferPeakBytes, 0); assert.equal(auto.info.scoreCalibrations, 0);
  assert.equal(sc.plannedUpdates, 100); assert.ok(sc.projectedCpuScoreSeconds >= 0 && sc.projectedCpuScoreSeconds < sc.thresholdSeconds); assert.equal(sc.thresholdSeconds, 0.5);
  assert.equal(sc.decision, 'CPU without opening CUDA'); assert.match(sc.reason, /below the 0\.500 s threshold/); assert.match(sc.trainingPath, /sampled deals/);
  assert.equal(auto.body, cpu.body); assert.equal(auto.info.rng, cpu.info.rng); assert.equal(auto.info.trainingDeals, cpu.info.trainingDeals); assert.equal(auto.info.stateVisits, cpu.info.stateVisits);
});
test('5.0 the same turn above the threshold (EM_AUTO_MIN_SCORE_SECONDS=0): Automatic opens CUDA and measures it, then keeps the CPU result; same state', { skip, timeout: 600000 }, t => {
  const dir = tmp(t), cpu = trainWith(dir, TURN, 'cpu', 100, 4, 1024), auto = trainWith(dir, TURN, 'auto', 100, 4, 1024, { EM_AUTO_MIN_SCORE_SECONDS: '0' });
  assert.ok(auto.driver && auto.driver.cuInitCalls >= 1, 'driver initialised');
  const sc = auto.info.scheduling; assert.equal(sc.cudaOpenedThisCall, true); assert.equal(sc.automaticSkippedCuda, false); assert.ok(sc.calibrationsThisCall >= 1); assert.equal(sc.thresholdSeconds, 0);
  assert.equal(auto.body, cpu.body); assert.equal(auto.info.rng, cpu.info.rng);
});
test('5.0 GPU Preferred and Hybrid keep their behaviour on the turn: they open the device, measure, may fall back to the CPU, and produce the CPU state', { skip, timeout: 600000 }, t => {
  const dir = tmp(t), cpu = trainWith(dir, TURN, 'cpu', 100, 4, 1024);
  for (const mode of ['gpu', 'hybrid']) {
    const r = trainWith(dir, TURN, mode, 100, 4, 1024);
    assert.ok(r.driver && r.driver.cuInitCalls >= 1, mode); assert.equal(r.info.scheduling.cudaOpenedThisCall, true, mode); assert.ok(r.info.scheduling.calibrationsThisCall >= 1, mode);
    assert.equal(r.info.scheduling.automaticSkippedCuda, false); assert.match(r.info.scheduling.decision, /CPU after measuring CUDA|CUDA|Hybrid/);
    assert.equal(r.body, cpu.body, mode); assert.equal(r.info.rng, cpu.info.rng, mode);
  }
});
test('5.0 the external-sampling shortcut still applies (six-player weighted study, 64-deal batches, 40 updates = 2,560 deals): no driver load, same state', { skip, timeout: 600000 }, t => {
  const dir = tmp(t), s = JSON.parse(fs.readFileSync(ES6, 'utf8')); s.batchDeals = 64; const spec = path.join(dir, 'es.json'); fs.writeFileSync(spec, JSON.stringify(s));
  const cpu = trainWith(dir, spec, 'cpu', 40, 4, 512), auto = trainWith(dir, spec, 'auto', 40, 4, 512);
  assert.equal(cpu.info.trainingDeals, 2560); assert.equal(auto.driver, null);
  assert.equal(auto.info.scheduling.trainingPath, 'external sampling'); assert.equal(auto.info.scheduling.automaticSkippedCuda, true); assert.equal(auto.info.automaticDeviceSkipped, true);
  assert.equal(auto.body, cpu.body); assert.equal(auto.info.rng, cpu.info.rng);
});
test('5.0 one engine, consecutive short / long / short calls: per-call scheduling diagnostics reset, every call counts only its own updates, state identical to CPU Only after every call', { skip, timeout: 900000 }, t => {
  const dir = tmp(t), exe = path.join(dir, 'sched50');
  // json.c is C: compile it separately and link
  const jo = path.join(dir, 'json.o'); cp.execFileSync(cc, ['-O2', '-c', path.join(native, 'json.c'), '-o', jo]);
  cp.execFileSync(cxx, ['-std=c++20', '-O2', '-ffp-contract=off', '-I' + native, path.join(__dirname, 'sched50.cpp'), path.join(native, 'mw.cpp'), jo, ...(win ? ['-static', '-pthread', '-lz', '-lbcrypt'] : ['-lpthread', '-ldl', '-lz']), '-o', exe + (win ? '.exe' : '')]);
  const run = (device, env = {}) => { const s = JSON.parse(fs.readFileSync(TURN, 'utf8')); s.device = device; const f = path.join(dir, 'seq-' + device + '.json'); fs.writeFileSync(f, JSON.stringify(s));
    const r = cp.spawnSync(exe + (win ? '.exe' : ''), [f, '4', '10,20000,10'], { encoding: 'utf8', env: { ...process.env, ...driverEnv(), ...env }, timeout: 900000 }); assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.trim().split('\n').map(l => JSON.parse(l)); return { calls: lines.slice(0, -1), final: lines.at(-1) }; };
  const cpu = run('cpu'), auto = run('auto', { EM_AUTO_MIN_SCORE_SECONDS: '0.1' });
  assert.deepEqual(auto.calls.map(c => c.scheduling.plannedUpdates), [10, 20000, 10]);
  assert.equal(auto.calls[0].scheduling.cudaOpenedThisCall, false); assert.equal(auto.calls[0].scheduling.automaticSkippedCuda, true);
  assert.equal(auto.calls[1].scheduling.cudaOpenedThisCall, true, 'the long call is above 0.1 s and is measured'); assert.ok(auto.calls[1].scheduling.calibrationsThisCall >= 1);
  const third = auto.calls[2].scheduling; assert.equal(third.cudaOpenedThisCall, false); assert.equal(third.calibrationsThisCall, 0); assert.equal(third.gpuBufferPeakBytesThisCall, 0, 'no stale per-call GPU bytes from the long call');
  for (let i = 0; i < 3; i++) assert.equal(auto.calls[i].rng, cpu.calls[i].rng, 'call ' + i);
  assert.equal(auto.final.bodySha256, cpu.final.bodySha256);
});
test('5.0 training reports carry the scheduling block on both paths (path, planned updates, projection, threshold, decision, reason, calibrations, GPU bytes)', { skip: (!tool() && 'no native CLI'), timeout: 300000 }, t => {
  const dir = tmp(t);
  for (const [spec, n, deals, pathRe] of [[TURN, 10, 8 * 3 * 10, /sampled deals/], [ES6, 5, null, /external sampling/]]) {
    const out = path.join(dir, 'x.state'), r = cp.spawnSync(tool(), [spec, n, 2, out, 512], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr);
    const sc = JSON.parse(r.stdout).scheduling;
    for (const k of ['trainingPath', 'requestedDevice', 'plannedUpdates', 'projectedCpuScoreSeconds', 'thresholdSeconds', 'automaticSkippedCuda', 'cudaOpenedThisCall', 'calibrationsThisCall', 'calibrationSecondsThisCall', 'gpuBufferPeakBytesThisCall', 'decision', 'reason']) assert.ok(k in sc, k);
    assert.match(sc.trainingPath, pathRe); assert.equal(sc.plannedUpdates, n); if (deals) assert.equal(JSON.parse(r.stdout).trainingDeals, deals);
  }
});
