'use strict';
// EightMax 4.2 regressions.
//  * Strategy coverage: the 4.1 table modified keys (key|1) and re-hashed stored
//    values on merge, so an information set observed, merged and observed again
//    counted twice; the seat was XOR-ed over state bits. tests/coverage42.cpp
//    checks the 4.2 table against a std::set reference (collisions, 1-8 workers,
//    merge orders, repeated merges, 300,000 keys) under ASan/UBSan and TSan; the
//    end-to-end tests compare engine counts with the EM_COVERAGE_AUDIT reference
//    and across thread counts for exact EVs, sampled EVs and response gains.
//  * CUDA: the Linux driver test double now enforces per-thread current contexts
//    like the real driver. It reproduces the 4.1 EV-table failure, and checks the
//    4.2 context guard, budgets, fault recovery, cleanup, concurrency and the
//    Automatic rule. All of this is simulated: NOT physical GPU validation.
//  * Exact EV / best-response pattern counting by projection is bit-identical to
//    the 4.1 per-board method.
const test = require('node:test'), assert = require('node:assert/strict');
const cp = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const E = require('../tools/loadlib');
for (const l of ['lib_runouts', 'lib_wide', 'lib_river']) require('../web/' + l);
const build = require('./native_build');
const { withHost, home } = require('./checkpoint_host');
const native = path.join(__dirname, '..', 'native');
const base = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128 };
const R3 = ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd'];
const FIXED8 = ['AsAh', 'KsKh', 'QsQh', 'JsJh', 'TsTh', '9s9h', '8s8h', '7s7h'], STACKS8 = [30, 22, 15, 40, 9, 18, 25, 12], PAY8 = [30, 20, 14, 11, 9, 7, 5, 4];
const studies = {
  huRiver: { ...base, board: 'Ks8d5h2c2s', common: 10, stacks: [20, 20], ranges: R3, streets: { river: { bets: '50,a', raises: 'a', maxBets: 2 } }, privateSeed: 3 },
  push8: { ...base, preflop: { mode: 'shove' }, board: '', dealt: 8, common: 0, stacks: STACKS8, ranges: FIXED8, icm: { payouts: PAY8 }, batchDeals: 4, actionStreams: 'deal', privateSeed: 4 },
  heavy8: { ...base, preflop: { mode: 'shove' }, board: '', dealt: 8, common: 0, stacks: STACKS8, ranges: ['AsAh,7c2d', 'KsKh,8c3d', 'QsQh,9c4d', 'JsJh,Tc5d', 'TsTh,Jc6d', '9s9h,Qc2h', '8s8h,Kc3h', '7s7h,Ac4h'], icm: { payouts: PAY8 }, batchDeals: 4, actionStreams: 'deal', privateSeed: 4 },
  push3: { ...base, preflop: { mode: 'shove' }, board: '', dealt: 3, common: 0, stacks: [12, 20, 9], ranges: ['AsAh,KcKd,7c7d', 'QsQh,AdKd,9c8c', 'JsJh,AcQc,5h5d'], icm: { payouts: [50, 30, 20] }, batchDeals: 4, actionStreams: 'deal', privateSeed: 5 },
};
const linux = process.platform === 'linux';
const cliPath = () => process.env.EM_TEST_MWCLI || build.cli().cli;
const cliSkip = !cliPath() && 'no native CLI';
const fx = () => build.cli().fixtureDir;
const fxSkip = !(linux && cliPath() && build.cli().fixtureDir) && 'needs the Linux CUDA driver test double (simulated driver; no physical GPU)';
const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'em42-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
function study(t, name, iterations) {
  const dir = tmp(t), spec = path.join(dir, 'spec.json'), state = path.join(dir, 'state'); let n = 0;
  fs.writeFileSync(spec, JSON.stringify(E.MultiwayGame(studies[name]).nativeSpec()));
  cp.execFileSync(cliPath(), [spec, String(iterations), '2', state, '512']);
  const run = (mode, query, env = {}) => {
    const q = path.join(dir, 'q' + (n++) + '.json'), stats = path.join(dir, 'fx' + n + '.json'); fs.writeFileSync(q, JSON.stringify(query));
    const r = cp.spawnSync(cliPath(), [mode, spec, state, q], { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, EM_FIXTURE_STATS: stats, ...env } });
    const driver = fs.existsSync(stats) ? JSON.parse(fs.readFileSync(stats, 'utf8')) : null;
    return { json: r.status === 0 ? JSON.parse(r.stdout) : null, error: r.stderr, status: r.status, signal: r.signal, driver };
  };
  return { dir, spec, state, ev: (q, env) => run('--ev', q, env), gain: (q, env) => run('--gain', q, env) };
}
function compile(t, name, args) {
  const dir = tmp(t), exe = path.join(dir, name);
  try { cp.execFileSync('g++', [...args, '-o', exe], { stdio: 'pipe' }); } catch (e) { return { skip: 'C++ compiler unavailable: ' + String(e.message).split('\n')[0] }; }
  return { exe };
}
const runJson = (exe, args, env = {}) => { const r = cp.spawnSync(exe, args, { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, ...env } }); return { status: r.status, out: r.stdout, err: r.stderr, json: (() => { try { return JSON.parse(r.stdout); } catch { return null; } })() }; };
const cov = j => { const { fallbackPolicy, fallbackDescription, warning, note, ...c } = j.coverage; return c; };

// ============================== Priority 1: strategy coverage ==============================
test('4.2 coverage: unit suite vs std::set reference (4.1 defect reproduced; collisions, 1-8 workers, merge orders, 300k keys)', t => {
  const b = compile(t, 'coverage42', ['-std=c++20', '-O2', '-I' + native, path.join(__dirname, 'coverage42.cpp'), '-lpthread']); if (b.skip) return t.skip(b.skip);
  const r = runJson(b.exe, []); assert.equal(r.status, 0, r.out + r.err);
  assert.equal(r.json.failures, 0); assert.ok(r.json.checks.length >= 16);
  const repro = r.json.checks.find(c => /reported 4.1 defect/.test(c.check)); assert.equal(repro.v41Distinct, 2); assert.equal(repro.v42Distinct, 1);
});
test('4.2 coverage: unit suite under AddressSanitizer+UBSan and ThreadSanitizer (compiler)', t => {
  for (const [name, flags] of [['asan', ['-fsanitize=address,undefined', '-fno-sanitize-recover=all']], ['tsan', ['-fsanitize=thread']]]) {
    const b = compile(t, 'cov_' + name, ['-std=c++20', '-O1', '-g', ...flags, '-I' + native, path.join(__dirname, 'coverage42.cpp'), '-lpthread']); if (b.skip) return t.skip(b.skip);
    const r = runJson(b.exe, [], { TSAN_OPTIONS: 'halt_on_error=1' }); assert.equal(r.status, 0, name + ': ' + r.err.slice(0, 2000)); assert.equal(r.json.failures, 0);
  }
});
test('4.2 coverage: engine counts equal the independent audit and are identical for 1, 2, 4 and 8 threads (exact and sampled EVs)', { skip: cliSkip }, t => {
  for (const [name, its, queries] of [['huRiver', 30, [{ path: [], hands: [0, 1, 2, 3, 4, 5], method: 'exact' }, { path: [], hands: [0, 1, 2, 3, 4, 5], method: 'sampled', samples: 3000, seed: 5 }]],
                                      ['push8', 10, [{ path: [], hands: [0], method: 'exact', maxVisits: 2000000000 }, { path: [1], hands: [0], method: 'sampled', samples: 3000, seed: 4 }]]]) {
    const S = study(t, name, its);
    for (const q of queries) {
      const runs = [1, 2, 4, 8].map(threads => S.ev({ ...q, threads }, { EM_COVERAGE_AUDIT: '1' }).json);
      for (const r of runs) {
        assert.ok(r, name + ' ' + q.method);
        const c = r.coverage;
        assert.equal(c.accounting, '4.2');
        assert.deepEqual([c.distinctInformationSets, c.distinctStoredInformationSets, c.distinctFallbackInformationSets],
          [c.audit.distinctInformationSets, c.audit.distinctStoredInformationSets, c.audit.distinctFallbackInformationSets], name + ' ' + q.method + ': engine equals audit');
        assert.equal(c.storedLookups + c.fallbackLookups, c.policyLookups, 'visits partition');
        assert.ok(c.distinctInformationSets <= c.policyLookups, 'distinct sets never exceed visits');
        assert.ok(c.distinctStoredInformationSets + c.distinctFallbackInformationSets >= c.distinctInformationSets);
      }
      for (const r of runs.slice(1)) assert.deepEqual(cov(r), cov(runs[0]), name + ' ' + q.method + ': coverage independent of thread count');
    }
  }
});
test('4.2 coverage: response gains report distinct sets per seat, identical for 1, 2 and 4 threads (exact, restricted, sampled)', { skip: cliSkip }, t => {
  const S = study(t, 'push8', 40);
  for (const q of [{ method: 'exact', seats: [0, 3, 6] }, { method: 'restricted', selection: 'sampled', samples: 1500 }, { method: 'sampled', samples: 1200, seats: [1, 2, 5] }]) {
    const runs = [1, 2, 4].map(threads => S.gain({ ...q, threads }).json);
    const pick = r => r.seats.map(s => [s.seat, s.policyLookups, s.fallbackLookups, s.distinctInformationSets, s.distinctFallbackInformationSets]);
    for (const r of runs) for (const s of r.seats) if (s.distinctInformationSets != null) assert.ok(s.distinctInformationSets <= s.policyLookups && s.distinctFallbackInformationSets <= s.distinctInformationSets);
    assert.deepEqual(pick(runs[1]), pick(runs[0]), q.method); assert.deepEqual(pick(runs[2]), pick(runs[0]), q.method);
  }
});

// ============================== Priorities 2-3: CUDA (driver test double) ==============================
test('4.2 CUDA: wrapper unit tests (context per thread, balance, concurrent instances, budgets, repeated init, OOM, cuCtxCreate path) (Linux CUDA test double)', { skip: fxSkip }, t => {
  const b = compile(t, 'cuda42', ['-std=c++20', '-O2', '-I' + native, path.join(__dirname, 'cuda42.cpp'), '-ldl', '-lpthread']); if (b.skip) return t.skip(b.skip);
  const dir = tmp(t);
  for (const [phase, fault] of [['all', ''], ['create', 'noprimary'], ['oom', 'allocAfter=1']]) {
    const stats = path.join(dir, phase + '.json');
    const r = runJson(b.exe, [phase], { LD_LIBRARY_PATH: fx(), EM_FIXTURE_STATS: stats, EM_FIXTURE_FAULT: fault });
    assert.equal(r.status, 0, phase + ': ' + r.out + r.err); assert.equal(r.json.failures, 0);
    const d = JSON.parse(fs.readFileSync(stats, 'utf8'));
    assert.equal(d.invalidContextCalls, 0, phase + ': no driver call without a current context');
    assert.equal(d.pushes, d.pops, phase + ': push/pop balanced'); assert.equal(d.liveBytesAtExit, 0, phase + ': no device memory left'); assert.equal(d.leakedBlocks, 0);
    assert.equal(d.contextsAliveAtExit, 0, phase + ': every context released'); assert.equal(d.primaryRetains, d.primaryReleases);
    if (phase === 'all') assert.ok(d.driverThreads >= 9, 'the device was used from many host threads');
  }
});
test('4.2 CUDA: the 4.1 EV-table failure is fixed — gpu/hybrid/auto with 1, 2, 4, 8 threads: identical EVs, no context errors, no leaks (Linux CUDA test double)', { skip: fxSkip }, t => {
  const S = study(t, 'push8', 40), env = { LD_LIBRARY_PATH: fx() };
  const q = { path: [], hands: [0], method: 'exact', timeLimitMs: 600000, maxVisits: 2000000000, gpuMiB: 2048 };
  const ref = S.ev({ ...q, device: 'cpu', threads: 1 }).json; assert.ok(ref);
  for (const threads of [1, 2, 4, 8]) for (const device of ['gpu', 'hybrid', 'auto']) {
    const r = S.ev({ ...q, device, threads }, env), x = r.json && r.json.execution;
    assert.ok(r.json, device + ' ' + threads + ': ' + r.error + ' signal ' + r.signal);
    assert.deepEqual(r.json.hands[0].ev, ref.hands[0].ev, device + ' ' + threads + ' identical to CPU');
    assert.equal(x.gpuFailures, 0, device + ' ' + threads + ': ' + JSON.stringify(x.gpuErrors)); assert.deepEqual(x.gpuErrors, []);
    assert.equal(x.boardsScored, x.cpuBoards + x.gpuBoards, 'every board scored exactly once');
    if (device === 'gpu') { assert.equal(x.gpuBoards, x.boardsScored - x.scheduling.gpuVerificationBoards, 'all but the CPU verification boards on the device'); assert.equal(x.observedDevice, x.cpuBoards ? 'cpu+gpu' : 'gpu'); assert.equal(x.cuda.primaryContext, true); }
    if (r.driver) { assert.equal(r.driver.invalidContextCalls, 0); assert.equal(r.driver.pushes, r.driver.pops); assert.equal(r.driver.liveBytesAtExit, 0); assert.equal(r.driver.contextsAliveAtExit, 0); }
    else assert.equal(device, 'auto', 'only Automatic may leave the driver unloaded (warm-up)');
  }
});
test('4.2 CUDA: GPU budget validation — a budget below the real request is refused before allocation and falls back with the same result; within budget the GPU runs (Linux CUDA test double)', { skip: fxSkip }, t => {
  const dir = tmp(t), q = path.join(dir, 'eq.json'), env = { ...process.env, LD_LIBRARY_PATH: fx() };
  const eq = (extra) => { fs.writeFileSync(q, JSON.stringify({ hands: [[0, 1], [2, 3], [4, 5]], board: [], device: 'gpu', threads: 2, ...extra })); const st = path.join(dir, 'st' + Math.random() + '.json');
    const r = cp.spawnSync(cliPath(), ['--equity', q], { encoding: 'utf8', env: { ...env, EM_FIXTURE_STATS: st } }); assert.equal(r.status, 0, r.stderr); return { j: JSON.parse(r.stdout), d: JSON.parse(fs.readFileSync(st, 'utf8')) }; };
  const big = eq({ gpuMiB: 1 }); const need = big.j.gpuRequestedBytes;
  assert.equal(big.j.gpuUsed, true, 'the 4.1 assumption was wrong: the equity kernel needs ' + need + ' bytes, far below 1 MiB, so 1 MiB legitimately runs on the GPU');
  assert.ok(need < 65536); assert.equal(big.j.gpuBufferPeakBytes, need);
  const under = eq({ gpuBudgetBytes: need - 1 }), at = eq({ gpuBudgetBytes: need });
  assert.equal(under.j.gpuUsed, false); assert.equal(under.j.gpuError.name, 'EM_GPU_BUDGET_EXCEEDED'); assert.equal(under.j.gpuError.requestedBytes, need); assert.equal(under.j.gpuError.cpuFallback, true);
  assert.equal(under.d.allocations, 0, 'refused before any device allocation'); assert.match(under.j.gpuFallbackReason, /requested \d+ bytes; budget \d+ bytes/);
  assert.equal(at.j.gpuUsed, true); assert.equal(at.d.peakBytes, need);
  assert.deepEqual(under.j.shareUnits, at.j.shareUnits, 'CPU fallback returns the identical exact result');
  for (const x of [under.d, at.d]) { assert.equal(x.liveBytesAtExit, 0); assert.equal(x.pushes, x.pops); }
  for (const bad of [0, -1, 1.5, 1e300, 9e9, '"5"']) { fs.writeFileSync(q, '{"hands":[[0,1],[2,3]],"device":"gpu","gpuBudgetBytes":' + bad + '}'); assert.notEqual(cp.spawnSync(cliPath(), ['--equity', q], { env }).status, 0, 'refused: ' + bad); }
  // EV tables: a budget below one table chunk sends every table to the CPU, does not disable the device, same EVs
  const S = study(t, 'push8', 40), evq = { path: [], hands: [0], method: 'exact', timeLimitMs: 600000, maxVisits: 2000000000, device: 'gpu', threads: 4 };
  const ok = S.ev(evq, { LD_LIBRARY_PATH: fx() }).json, tight = S.ev({ ...evq, gpuBudgetBytes: 4096 }, { LD_LIBRARY_PATH: fx() });
  const x = tight.json.execution;
  assert.deepEqual(tight.json.hands[0].ev, ok.hands[0].ev); assert.equal(x.gpuBoards, 0); assert.ok(x.scheduling.gpuDeclinedTransient > 0);
  assert.equal(x.cuda.available, true, 'a budget refusal does not disable the device'); assert.equal(x.gpuErrors[0].name, 'EM_GPU_BUDGET_EXCEEDED'); assert.equal(x.gpuErrors[0].cpuFallback, true);
  assert.equal(x.gpuErrors[0].budgetBytes, 4096); assert.ok(x.gpuErrors[0].requestedBytes > 4096);
  assert.equal(tight.driver.liveBytesAtExit, 0); assert.equal(x.boardsScored, x.cpuBoards);
  assert.ok(ok.execution.gpuPeakMiB > 0 && ok.execution.gpuPeakMiB * 1048576 <= 2048 * 1048576, 'peak VRAM reported within budget');
});
test('4.2 CUDA: fault injection — every failure falls back with identical EVs, no double counting, released buffers, actionable errors (Linux CUDA test double)', { skip: fxSkip }, t => {
  const S = study(t, 'push8', 40), q = { path: [], hands: [0], method: 'exact', timeLimitMs: 600000, maxVisits: 2000000000, device: 'gpu', threads: 4 };
  const ref = S.ev({ ...q, device: 'cpu' }).json.hands[0].ev;
  const expect = { alloc: ['CUDA_ERROR_OUT_OF_MEMORY', true], pressure: ['EM_VRAM_RESERVE', true], launch: ['CUDA_ERROR_LAUNCH_FAILED', false], download: ['CUDA_ERROR_LAUNCH_FAILED', false], mismatch: ['EM_GPU_MISMATCH', false], 'allocAfter=2': ['CUDA_ERROR_OUT_OF_MEMORY', true] };
  for (const [fault, [name, keeps]] of Object.entries(expect)) {
    const r = S.ev(q, { LD_LIBRARY_PATH: fx(), EM_FIXTURE_FAULT: fault }); assert.ok(r.json, fault + ': ' + r.error);
    const x = r.json.execution;
    assert.deepEqual(r.json.hands[0].ev, ref, fault + ': identical to CPU');
    assert.equal(x.boardsScored, x.cpuBoards + x.gpuBoards, fault + ': each board counted once');
    assert.ok(x.gpuErrors.length > 0, fault); const e = x.gpuErrors[0];
    assert.equal(e.name, name, fault + ': ' + JSON.stringify(e)); assert.equal(e.cpuFallback, true);
    for (const k of ['operation', 'code', 'description', 'hostThread', 'context', 'requestedBytes', 'freeBytes', 'totalBytes', 'budgetBytes', 'reserveBytes']) assert.ok(k in e, fault + ' reports ' + k);
    assert.equal(x.cuda.available, keeps, fault + (keeps ? ': transient, device kept' : ': device disabled'));
    assert.equal(r.driver.liveBytesAtExit, 0, fault + ': buffers released'); assert.equal(r.driver.pushes, r.driver.pops); assert.equal(r.driver.invalidContextCalls, 0);
    assert.doesNotMatch(JSON.stringify(e), /0x[0-9a-f]{6,}/i, 'no device pointers in diagnostics');
  }
});
test('4.2 CUDA: cancellation during GPU work is prompt and leaves no device memory (Linux CUDA test double)', { skip: fxSkip }, t => {
  const S = study(t, 'push8', 40), q = { path: [], hands: [0], method: 'exact', timeLimitMs: 600000, maxVisits: 2000000000, device: 'gpu', threads: 4 };
  for (const after of [5, 40, 120]) {
    const r = S.ev(q, { LD_LIBRARY_PATH: fx(), EM_FIXTURE_FAULT: 'slow', EM_CANCEL_AFTER_MS: String(after) });
    const line = r.error.split('\n').find(l => l.startsWith('{"queryMs"')); assert.ok(line, r.error); const timing = JSON.parse(line);
    if (timing.status === 409) assert.ok(timing.cancelLatencyMs < 250, 'cancelled in ' + timing.cancelLatencyMs + ' ms');
    assert.equal(r.driver.liveBytesAtExit, 0); assert.equal(r.driver.pushes, r.driver.pops);
  }
});
test('4.2 CUDA: Automatic mode — no CUDA start-up for short runs (warm-up), opened once the warm-up is spent, every table accounted for (Linux CUDA test double)', { skip: fxSkip }, t => {
  const S = study(t, 'push8', 40), q = { path: [], hands: [0], method: 'exact', timeLimitMs: 600000, maxVisits: 2000000000, device: 'auto', threads: 2 };
  const a = S.ev(q, { LD_LIBRARY_PATH: fx() });
  assert.equal(a.driver, null, 'the driver library was never loaded'); const s = a.json.execution.scheduling;
  assert.ok(s.cpuGpuWarmup > 0); assert.equal(a.json.execution.cuda.attempted, false); assert.equal(a.json.execution.observedDevice, 'cpu');
  const b = S.ev(q, { LD_LIBRARY_PATH: fx(), EM_GPU_INIT_ESTIMATE_S: '0' }), x = b.json.execution, z = x.scheduling;
  // 4.3 amendment: once the warm-up is spent Automatic starts CUDA on a BACKGROUND thread and never
  // stalls a table on start-up (4.2 opened and verified the device inside this request, which cost
  // 63-73 ms on the RTX 4060 Ti). With 4.3's single shared table this request ends on the CPU; the
  // device is used by later tables (tests/v43.test.js, session tests).
  assert.ok(z.gpuBackgroundOpens >= 1, 'start-up requested once the warm-up is spent'); assert.equal(x.profileSeconds.cudaStartup, 0, 'no table waited for CUDA start-up');
  assert.equal(z.cpuForced + z.cpuSmallTable + z.cpuGpuWarmup + (z.cpuGpuOpening || 0) + z.cpuGpuSlower + z.cpuGpuUnavailable + z.cpuGpuBusy + z.cpuAfterGpuFailure + x.gpuTables + x.hybridTables, x.showdownTables, JSON.stringify(x));
  assert.deepEqual(b.json.hands[0].ev, a.json.hands[0].ev);
  assert.match(z.rule, /warm-up|start-up/);
});
test('4.2 CUDA: in-process stress — concurrent multithreaded GPU jobs, cancellation on the GPU and repeated re-initialisation; plain, TSan and ASan builds (Linux CUDA test double)', { skip: fxSkip }, t => {
  const S = study(t, 'push8', 40), dir = tmp(t);
  const tool = path.join(__dirname, '..', 'tools', 'gpu_stress42.cpp');
  const variants = [['plain', ['-O2'], {}], ['tsan', ['-O1', '-g', '-fsanitize=thread'], { TSAN_OPTIONS: 'halt_on_error=1' }], ['asan', ['-O1', '-g', '-fsanitize=address,undefined', '-fno-sanitize-recover=all'], { ASAN_OPTIONS: 'detect_leaks=0' }]];
  for (const [name, flags, env] of variants) {
    const json = path.join(dir, 'json_' + name + '.o'), exe = path.join(dir, 'gs_' + name);
    try { cp.execFileSync('gcc', [...flags.filter(f => f !== '-fno-sanitize-recover=all'), '-c', path.join(native, 'json.c'), '-o', json]); cp.execFileSync('g++', ['-std=c++20', ...flags, '-ffp-contract=off', '-I' + native, path.join(native, 'mw.cpp'), tool, json, '-lpthread', '-ldl', '-o', exe]); }
    catch (e) { return t.skip('compiler: ' + String(e.message).split('\n')[0]); }
    let lib = fx();
    if (name === 'tsan') { lib = path.join(dir, 'fxt'); fs.mkdirSync(lib); cp.execFileSync('g++', ['-std=c++20', '-O1', '-g', '-fsanitize=thread', '-shared', '-fPIC', path.join(__dirname, 'cuda_driver_fixture.cpp'), '-o', path.join(lib, 'libcuda.so.1')]); }
    const stats = path.join(dir, 'st_' + name + '.json');
    const r = runJson(exe, [S.spec, S.state, name === 'plain' ? '3' : '2', '4'], { LD_LIBRARY_PATH: lib, EM_FIXTURE_STATS: stats, ...env });
    assert.equal(r.status, 0, name + ': ' + r.err.slice(0, 3000)); assert.equal(r.json.failures, 0);
    assert.ok(r.json.cancelledJobs >= 1, 'jobs were cancelled while using the GPU'); assert.ok(r.json.cudaReinitialisations >= 6);
    assert.ok(r.json.runs.every(x => x.identicalToCpu), name + ': every result identical to the CPU');
    assert.ok(r.json.runs.some(x => x.phase === 'concurrent' && x.gpuBoards > 0), 'concurrent jobs really used the device');
    const d = JSON.parse(fs.readFileSync(stats, 'utf8'));
    assert.equal(d.invalidContextCalls, 0); assert.equal(d.pushes, d.pops); assert.equal(d.liveBytesAtExit, 0); assert.equal(d.contextsAliveAtExit, 0);
    assert.doesNotMatch(r.err, /ThreadSanitizer|AddressSanitizer|runtime error/);
  }
  // LeakSanitizer on a CPU-only run (no driver double loaded, whose immortal state would be reported)
  const json = path.join(dir, 'json_lsan.o'), exe = path.join(dir, 'gs_lsan');
  cp.execFileSync('gcc', ['-O1', '-g', '-fsanitize=address', '-c', path.join(native, 'json.c'), '-o', json]);
  cp.execFileSync('g++', ['-std=c++20', '-O1', '-g', '-fsanitize=address', '-ffp-contract=off', '-I' + native, path.join(native, 'mw.cpp'), tool, json, '-lpthread', '-ldl', '-o', exe]);
  const r = runJson(exe, [S.spec, S.state, '1', '2'], { LD_LIBRARY_PATH: path.join(dir, 'empty') });
  assert.doesNotMatch(r.err, /LeakSanitizer|AddressSanitizer/, r.err.slice(0, 2000));
});
test('4.2 CUDA: desktop host — concurrent GPU EV jobs, a job cancelled on the GPU, the host stays responsive (Linux CUDA test double)', { skip: fxSkip }, async t => {
  const E2 = E.MultiwayGame(studies.push8).nativeSpec();
  await withHost(home(t), { LD_LIBRARY_PATH: fx(), EIGHTMAX_THREADS: '4' }, async api => {
    assert.equal((await api('mw/init', JSON.stringify(E2))).status, 200);
    assert.equal((await api('mw/train', { iterations: 40, threads: 2 })).status, 200);
    for (;;) { const s = await (await api('mw/status')).json(); if (!s.running) break; await new Promise(r => setTimeout(r, 20)); }
    await api('mw/jobs/config', { workers: 3, threadsPerJob: 2 });
    const post = async q => (await (await api('mw/jobs/ev', q)).json());
    const wait = async id => { for (;;) { const j = await (await api('mw/jobs/' + id)).json(); if (!['pending', 'running'].includes(j.status)) return j; await new Promise(r => setTimeout(r, 20)); } };
    const q = (device, i) => ({ path: [], hands: [0], method: 'exact', device, threads: 2, timeLimitMs: 600000, maxVisits: 2000000000 - i });
    const ids = [await post(q('gpu', 1)), await post(q('hybrid', 2)), await post(q('cpu', 3))].map(j => j.jobId);
    const victim = (await post(q('gpu', 4))).jobId; await new Promise(r => setTimeout(r, 30)); await api('mw/jobs/' + victim + '/cancel', {});
    const done = await Promise.all(ids.map(wait)); for (const d of done) assert.equal(d.status, 'completed', JSON.stringify(d));
    const results = await Promise.all(ids.map(async id => (await (await api('mw/jobs/' + id + '/result')).json())));
    for (const r of results) assert.deepEqual(r.hands[0].ev, results[2].hands[0].ev, 'GPU, hybrid and CPU jobs agree');
    assert.ok(results[0].execution.gpuBoards > 0, 'the GPU job used the device: ' + JSON.stringify(results[0].execution.gpuErrors));
    const v = await wait(victim); assert.ok(['cancelled', 'completed'].includes(v.status));
    const again = await wait((await post(q('gpu', 5))).jobId); assert.equal(again.status, 'completed', 'the device and host still work after cancellation');
    const cfg = (await (await api('mw/jobs')).json()).config; assert.equal(cfg.running, 0);
  });
});

// ============================== Priority 4/8: exact pattern counting ==============================
test('4.2 performance: exact EVs and best responses by pattern projection are bit-identical to the 4.1 per-board method', { skip: cliSkip }, t => {
  for (const [name, its, evs] of [['push8', 40, [{ path: [], hands: [0] }, { path: [1, 1], hands: [0] }]], ['push3', 60, [{ path: [], hands: [0, 1, 2], range: true }, { path: [1], hands: [0, 2] }]]]) {
    const S = study(t, name, its);
    for (const e of evs) {
      const q = { ...e, method: 'exact', threads: 2, maxVisits: 2000000000 };
      const a = S.ev(q).json, b = S.ev(q, { EM_EV_DIRECT_PATTERNS: '1' }).json; assert.ok(a && b, name);
      assert.deepEqual(a.hands.map(h => h.ev), b.hands.map(h => h.ev), name + ' EV'); if (a.range) assert.deepEqual(a.range.ev, b.range.ev);
    }
    const g = S.gain({ method: 'exact', threads: 2 }).json, h = S.gain({ method: 'exact', threads: 2 }, { EM_EV_DIRECT_PATTERNS: '1' }).json;
    assert.deepEqual(g.seats.map(s => s.gain), h.seats.map(s => s.gain), name + ' exact gains');
    if (name === 'push8') assert.ok(g.execution.profileSeconds.patternCounting <= h.execution.profileSeconds.patternCounting, 'projection is not slower');
  }
});

// ============================== deadlines and cancellation on the 4.2 path ==============================
// The v40/v41 deadline tests run with the retained 4.1 per-board method (their
// workloads are now faster than their limits). These use the projection path
// with an eight-player study with two hands per seat, whose exact range
// evaluation still takes about 20-80 s on the development machine.
const heavyQ = { path: [], hands: [0, 1], range: true, method: 'exact', maxVisits: 2000000000, threads: 2 };
test('4.2 deadlines: exact evaluation on the projection path honours 100 ms and 150 ms limits and publishes no exact numbers', { skip: cliSkip }, t => {
  const S = study(t, 'heavy8', 40);
  for (const limit of [100, 150]) {
    const t0 = Date.now(), r = S.ev({ ...heavyQ, timeLimitMs: limit }, { EM_QUERY_TIMING: '1' }), wall = Date.now() - t0;
    assert.equal(r.json, null, 'no exact result after a timeout'); assert.match(r.error, /408/);
    const timing = JSON.parse(r.error.split('\n').find(l => l.startsWith('{"queryMs"')));
    assert.ok(timing.queryMs < limit + 60, limit + ' ms limit, query took ' + timing.queryMs + ' ms (process ' + wall + ' ms)');
  }
  const g = S.gain({ method: 'exact', threads: 2, timeLimitMs: 150 }); assert.equal(g.json, null); assert.match(g.error, /408|422/);
});
test('4.2 cancellation: exact EV and exact response gains on the projection path stop promptly', { skip: cliSkip }, t => {
  const S = study(t, 'heavy8', 40);
  for (const [mode, q] of [['ev', { ...heavyQ, timeLimitMs: 600000 }], ['gain', { method: 'exact', threads: 2, timeLimitMs: 600000 }]]) {
    const r = S[mode](q, { EM_CANCEL_AFTER_MS: '200' }); const timing = JSON.parse(r.error.split('\n').find(l => l.startsWith('{"queryMs"')));
    assert.equal(timing.status, 409, mode); assert.ok(timing.cancelLatencyMs < 250, mode + ' cancelled in ' + timing.cancelLatencyMs + ' ms');
  }
});
test('4.2 jobs: a job queued behind a long exact evaluation still receives its full time limit (projection path)', { skip: !(process.env.EM_TEST_HOST || build.host().exe) && 'no native host' }, async t => {
  await withHost(home(t), {}, async api => {
    assert.equal((await api('mw/init', JSON.stringify(E.MultiwayGame(studies.heavy8).nativeSpec()))).status, 200);
    assert.equal((await api('mw/train', { iterations: 40, threads: 2 })).status, 200);
    for (;;) { const s = await (await api('mw/status')).json(); if (!s.running) break; await new Promise(r => setTimeout(r, 20)); }
    await api('mw/jobs/config', { workers: 1, threadsPerJob: 1 });
    const get = async id => (await api('mw/jobs/' + id)).json();
    const blocker = await (await api('mw/jobs/ev', { ...heavyQ, threads: 1, timeLimitMs: 600000 })).json();
    for (;;) { if ((await get(blocker.jobId)).status === 'running') break; await new Promise(r => setTimeout(r, 10)); }
    const queued = await (await api('mw/jobs/ev', { path: [1, 1], hands: [0], method: 'sampled', samples: 400, timeLimitMs: 400 })).json();
    await new Promise(r => setTimeout(r, 900));
    assert.equal((await get(blocker.jobId)).status, 'running', 'the blocker is still running after 900 ms');
    await api('mw/jobs/' + blocker.jobId + '/cancel', {});
    let done; for (;;) { done = await get(queued.jobId); if (!['pending', 'running'].includes(done.status)) break; await new Promise(r => setTimeout(r, 10)); }
    assert.equal(done.status, 'completed', done.error); assert.equal(done.partial, false); assert.ok(done.queuedMs >= 800, String(done.queuedMs));
  });
});
