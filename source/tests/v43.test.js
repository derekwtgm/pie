'use strict';
// EightMax 4.3 regressions.
//  * Shared showdown tables: one table per request (not per worker / per seat),
//    built cooperatively in chunks; fused full-seat rank patterns. EVs and
//    response gains must be BIT-IDENTICAL to 4.2 (values recorded from the 4.2
//    release and from the RTX 4060 Ti report), identical across thread counts,
//    identical with private tables (EM_EV_PRIVATE_TABLES=1) and with the 4.1
//    per-board pattern method, and every board must be scored exactly once.
//  * CUDA lifecycle (Linux driver test double: a SIMULATED driver, NOT physical
//    GPU validation): one context and one verification per process, warm reuse
//    across requests, background start-up, idle buffer release, recovery after
//    cancellation and after a budget refusal, gpu/hybrid/auto x threads parity,
//    fault injection, no lock waiting for shared tables, no leaks, balanced
//    context push/pop, no invalid-context calls.
//  * Automatic cost model and building blocks: tests/table43.cpp.
//  * Coverage capacity: tests/coverage43.cpp (100k-2M information sets, 1-16
//    workers, exact references; lower bounds and labelled estimates when capped)
//    and the coverageMiB request field.
const test = require('node:test'), assert = require('node:assert/strict');
const cp = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const E = require('../tools/loadlib');
for (const l of ['lib_runouts', 'lib_wide', 'lib_river']) require('../web/' + l);
const build = require('./native_build');
const native = path.join(__dirname, '..', 'native');
const fixtures40 = path.join(__dirname, '..', '..', 'validation', '4.0', 'fixtures');
const base = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128 };
const STACKS8 = [30, 22, 15, 40, 9, 18, 25, 12], PAY8 = [30, 20, 14, 11, 9, 7, 5, 4];
const studies = {
  heavy8: { ...base, preflop: { mode: 'shove' }, board: '', dealt: 8, common: 0, stacks: STACKS8, ranges: ['AsAh,7c2d', 'KsKh,8c3d', 'QsQh,9c4d', 'JsJh,Tc5d', 'TsTh,Jc6d', '9s9h,Qc2h', '8s8h,Kc3h', '7s7h,Ac4h'], icm: { payouts: PAY8 }, batchDeals: 4, actionStreams: 'deal', privateSeed: 4 },
  flop3: { ...base, board: 'Kh8d4c', common: 6, stacks: [8, 15, 30], ranges: ['AhKs,8h8c', 'KdQd,JcTc', 'AsAd,9h9d'], streets: { flop: { bets: '50,a', raises: 'a', maxBets: 1 }, turn: { bets: 'a', raises: '', maxBets: 1 }, river: { bets: 'a', raises: '', maxBets: 1 } }, privateSeed: 6 },
  turn4: { ...base, board: 'Qh9c4d2s', common: 8, stacks: [6, 14, 25, 40], ranges: ['AhQs,9h9d,KcJc', 'Kh9s,4h4c,JdTd', 'AcAd,Qc8c,7s6s', 'QdJh,5d3d,Ks2h'], streets: { turn: { bets: '50,a', raises: 'a', maxBets: 2 }, river: { bets: '75,a', raises: 'a', maxBets: 1 } }, privateSeed: 7 },
};
// Recorded with the unmodified 4.2 release (Linux build; the Windows builds of 4.2 and 4.3 print the same
// values under Wine). hardware-validation.json shows seat 2 as 0.0074652466318276814 because PowerShell 5.1's
// "R" format does not always round-trip; the Windows self-test compares strings formatted the same way.
const PUSH8_EV_42 = [15.020151348500445, 15.670177585564113];
const PUSH8_GAINS_42 = [0.54263262635152465, 0.05855764838526234, 0.0074652466318276822, 0.036214272672570047, 0.13927187905377458, 0.056570785543962998, 0.10626431827068394, 0.13421150102554513];
const linux = process.platform === 'linux';
const cliPath = () => process.env.EM_TEST_MWCLI || build.cli().cli;
const cliSkip = !cliPath() && 'no native CLI';
const fx = () => build.cli().fixtureDir;
const fxSkip = !(linux && cliPath() && build.cli().fixtureDir) && 'needs the Linux CUDA driver test double (simulated driver; no physical GPU)';
const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'em43-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
function runner(t, spec, state) {
  const dir = tmp(t); let n = 0;
  const run = (mode, query, env = {}, file) => {
    const q = path.join(dir, 'q' + (n++) + '.json'), stats = path.join(dir, 'fx' + n + '.json'); fs.writeFileSync(q, typeof query === 'string' ? query : JSON.stringify(query));
    const r = cp.spawnSync(cliPath(), [mode, spec, state, file || q], { encoding: 'utf8', maxBuffer: 1 << 27, env: { ...process.env, EM_FIXTURE_STATS: stats, ...env } });
    const driver = fs.existsSync(stats) ? JSON.parse(fs.readFileSync(stats, 'utf8')) : null;
    return { json: r.status === 0 ? (() => { try { return JSON.parse(r.stdout); } catch { return null; } })() : null, error: r.stderr, status: r.status, signal: r.signal, driver };
  };
  return { dir, spec, state, ev: (q, env) => run('--ev', q, env), gain: (q, env) => run('--gain', q, env), session: (planFile, env) => run('--session', '{}', env, planFile) };
}
const fixture = t => runner(t, path.join(fixtures40, 'push8-icm.spec.json'), path.join(fixtures40, 'push8-icm.state'));
function study(t, name, iterations) {
  const dir = tmp(t), spec = path.join(dir, 'spec.json'), state = path.join(dir, 'state');
  fs.writeFileSync(spec, JSON.stringify(E.MultiwayGame(studies[name]).nativeSpec()));
  cp.execFileSync(cliPath(), [spec, String(iterations), '2', state, '512']);
  return runner(t, spec, state);
}
function compile(t, name, args) {
  const dir = tmp(t), exe = path.join(dir, name);
  try { cp.execFileSync('g++', [...args, '-o', exe], { stdio: 'pipe' }); } catch (e) { return { skip: 'C++ compiler unavailable: ' + String(e.message).split('\n')[0] }; }
  return { exe };
}
const runJson = (exe, args, env = {}) => { const r = cp.spawnSync(exe, args, { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, ...env } }); return { status: r.status, out: r.stdout, err: r.stderr, json: (() => { try { return JSON.parse(r.stdout); } catch { return null; } })() }; };
const relClose = (a, b, tol) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= tol * Math.max(1, Math.abs(b[i])));
const EXACT = { path: [], hands: [0], method: 'exact', timeLimitMs: 600000, maxVisits: 2000000000 };

// ============================== shared tables: bit-identical to 4.2 ==============================
test('4.3 shared tables: exact EV on the eight-player ICM fixture is bit-identical to 4.2 for 1, 2, 4, 8 threads and scores the table once', { skip: cliSkip }, t => {
  const S = fixture(t);
  for (const threads of [1, 2, 4, 8]) {
    const r = S.ev({ ...EXACT, device: 'cpu', threads }); assert.ok(r.json, r.error);
    assert.deepEqual(r.json.hands[0].ev, PUSH8_EV_42, threads + ' threads');
    const x = r.json.execution;
    assert.equal(x.boardsScored, 376992, threads + ' threads: one table of 376,992 boards (4.2 scored it once per worker)');
    assert.equal(x.cpuBoards, 376992); assert.equal(x.tables43.sharing, 'request-wide');
    assert.equal(x.tables43.tablesBuiltByThisRequest, 1);
  }
  // 4.2 behaviour on request (A/B): private per-worker tables, same values
  const p = S.ev({ ...EXACT, device: 'cpu', threads: 4 }, { EM_EV_PRIVATE_TABLES: '1' }); assert.ok(p.json, p.error);
  assert.deepEqual(p.json.hands[0].ev, PUSH8_EV_42); assert.match(p.json.execution.tables43.sharing, /private/);
  // the 4.1 per-board pattern method, same values
  const d = S.ev({ ...EXACT, device: 'cpu', threads: 4 }, { EM_EV_DIRECT_PATTERNS: '1' }); assert.deepEqual(d.json.hands[0].ev, PUSH8_EV_42);
});
test('4.3 shared tables: eight-seat exact response gains bit-identical to 4.2 for 1, 2, 4, 8 threads; one table for all seats', { skip: cliSkip }, t => {
  const S = fixture(t);
  for (const threads of [1, 2, 4, 8]) {
    const r = S.gain({ method: 'exact', seats: [0, 1, 2, 3, 4, 5, 6, 7], threads, timeLimitMs: 600000 }); assert.ok(r.json, r.error);
    assert.deepEqual(r.json.seats.map(s => s.gain), PUSH8_GAINS_42, threads + ' threads');
    assert.equal(r.json.execution.boardsScored, 376992, '4.2 scored 3,015,936 boards (the same table once per seat)');
    for (const s of r.json.seats) assert.equal(s.distinctCountKind, 'exact');
  }
});
test('4.3 shared tables: multiway studies (8-player two-hand ranges, 3-player flop with linked turn/river, 4-player turn; side pots) identical across threads, private tables and the 4.2 per-board enumeration', { skip: cliSkip, timeout: 900000 }, t => {
  for (const [name, iters, q, gainSeats] of [
    ['heavy8', 30, { ...EXACT, hands: [0] }, null],
    ['flop3', 300, { ...EXACT, hands: [0, 1] }, [0, 1, 2]],
    ['turn4', 400, { ...EXACT, hands: [0, 1, 2] }, [0, 1, 2, 3]],
  ]) {
    const S = study(t, name, iters);
    const ref = S.ev({ ...q, device: 'cpu', threads: 1 }); assert.ok(ref.json, name + ': ' + ref.error);
    const evs = j => j.hands.map(h => h.ev).flat();
    const shared = {}; for (const threads of [2, 4]) { const r = S.ev({ ...q, device: 'cpu', threads }); assert.ok(r.json, name + ' ' + threads + ': ' + r.error); assert.deepEqual(evs(r.json), evs(ref.json), name + ' ' + threads + ' threads'); shared[threads] = r.json.execution.boardsScored; }
    const p = S.ev({ ...q, device: 'cpu', threads: 4 }, { EM_EV_PRIVATE_TABLES: '1' }); assert.ok(p.json, name + ' private: ' + p.error); assert.deepEqual(evs(p.json), evs(ref.json), name + ' private tables');
    // (with many distinct tables the bounded cache evicts and rebuilds, so counts depend on scheduling;
    // sharing must never score more than private per-worker tables)
    assert.ok(shared[4] <= p.json.execution.boardsScored, name + ': shared ' + shared[4] + ' <= private ' + p.json.execution.boardsScored);
    if (name !== 'heavy8') {   // 3.9 per-board enumeration (same expectation, other summation order); far too slow for eight-player preflop
      const nt = S.ev({ ...q, device: 'cpu', threads: 2 }, { EM_EV_NO_TABLES: '1' }); assert.ok(nt.json, name + ' per-board: ' + nt.error);
      assert.ok(relClose(evs(nt.json), evs(ref.json), 1e-9), name + ' per-board enumeration');
    }
    if (!gainSeats) continue;   // exact eight-seat best responses with two hands per seat take minutes (benchmarks only)
    const g1 = S.gain({ method: 'exact', seats: gainSeats, threads: 1, timeLimitMs: 600000 }), g4 = S.gain({ method: 'exact', seats: gainSeats, threads: 4, timeLimitMs: 600000 }), gp = S.gain({ method: 'exact', seats: gainSeats, threads: 4, timeLimitMs: 600000 }, { EM_EV_PRIVATE_TABLES: '1' });
    assert.ok(g1.json && g4.json && gp.json, name + ' gains: ' + g1.error + g4.error + gp.error);
    assert.deepEqual(g4.json.seats.map(s => s.gain), g1.json.seats.map(s => s.gain), name + ' gains threads');
    assert.deepEqual(gp.json.seats.map(s => s.gain), g1.json.seats.map(s => s.gain), name + ' gains private');
  }
});
test('4.3 shared tables: cancellation inside cooperative table construction stops promptly (helpers joined, no hang) and the next request is exact', { skip: cliSkip }, t => {
  const S = fixture(t);
  for (const [site, n] of [['table', 3], ['table', 200000], ['pattern', 1000]]) {
    const r = S.ev({ ...EXACT, device: 'cpu', threads: 8 }, { EM_EV_FAULT: site + ':' + n, EM_QUERY_TIMING: '1' });
    assert.equal(r.status, 1, site + ':' + n + ' must stop'); assert.match(r.error, /error 409/);
    assert.equal(r.signal, null);
  }
  const c = S.ev({ ...EXACT, device: 'cpu', threads: 8 }, { EM_EV_DIRECT_PATTERNS: '1', EM_CANCEL_AFTER_MS: '20' });
  const line = c.error.split('\n').find(l => l.startsWith('{"queryMs"')); const j = JSON.parse(line);
  if (j.status === 409) assert.ok(j.cancelLatencyMs < 250, 'cancellation latency ' + j.cancelLatencyMs + ' ms');
  const ok = S.ev({ ...EXACT, device: 'cpu', threads: 8 }); assert.deepEqual(ok.json.hands[0].ev, PUSH8_EV_42);
});
test('4.3 shared tables: the shared cache stays inside a tight request memory budget (16 MiB) with identical results for 1-8 threads', { skip: cliSkip }, t => {
  const S = fixture(t);
  for (const threads of [1, 4, 8]) {
    const r = S.ev({ ...EXACT, device: 'cpu', threads, memoryMiB: 16 }); assert.ok(r.json, r.error);
    assert.deepEqual(r.json.hands[0].ev, PUSH8_EV_42);
    assert.ok(r.json.execution.peakEvaluationMiB <= 16, 'peak ' + r.json.execution.peakEvaluationMiB + ' MiB');
  }
});
// ============================== building blocks ==============================
test('4.3 units: fullPattern = 4.2 rankPattern, flat histogram, Automatic cost model, table cache eviction', t => {
  const b = compile(t, 'table43', ['-std=c++20', '-O2', '-I' + native, path.join(__dirname, 'table43.cpp'), '-ldl', '-lpthread']); if (b.skip) return t.skip(b.skip);
  const r = runJson(b.exe, ['units']); assert.equal(r.status, 0, r.out + r.err); assert.equal(r.json.failures, 0);
  assert.ok(r.json.checks.length >= 15);
});
test('4.3 coverage capacity: 100k-2M information sets, 1-16 workers, exact against sorted references; capped tables report lower bounds and labelled estimates', { timeout: 600000 }, t => {
  const b = compile(t, 'coverage43', ['-std=c++20', '-O2', '-I' + native, path.join(__dirname, 'coverage43.cpp'), '-lpthread']); if (b.skip) return t.skip(b.skip);
  const r = runJson(b.exe, []); assert.equal(r.status, 0, (r.out || '').slice(0, 4000) + r.err); assert.equal(r.json.failures, 0);
  assert.ok(r.json.checks.length >= 100, 'all sizes and worker counts ran');
  // the 4.2 suite still passes against the 4.3 table (API, cap flag, collisions, merge orders)
  const b2 = compile(t, 'coverage42', ['-std=c++20', '-O2', '-I' + native, path.join(__dirname, 'coverage42.cpp'), '-lpthread']);
  const r2 = runJson(b2.exe, []); assert.equal(r2.status, 0, r2.out); assert.equal(r2.json.failures, 0);
});
test('4.3 coverage capacity: coverageMiB is validated, reported, and the counts stay exact and thread-independent (engine = audit)', { skip: cliSkip }, t => {
  const S = fixture(t);
  for (const bad of [0, 4097, 1e300, 0.5, '"8"']) {
    const r = S.ev(`{"path":[],"hands":[0],"method":"exact","coverageMiB":${bad}}`); assert.notEqual(r.status, 0, 'coverageMiB ' + bad); assert.match(r.error, /coverageMiB/);
  }
  const rows = [1, 2, 8].map(threads => S.ev({ ...EXACT, threads, coverageMiB: 1 }, { EM_COVERAGE_AUDIT: '1' }).json.coverage);
  for (const c of rows) {
    assert.equal(c.distinctCountKind, 'exact'); assert.equal(c.capacity.exactKeyLimit, 32768); assert.equal(c.capacityModel, '4.3'); assert.equal(c.accounting, '4.2');
    assert.equal(c.distinctInformationSets, c.audit.distinctInformationSets); assert.equal(c.distinctStoredInformationSets, c.audit.distinctStoredInformationSets); assert.equal(c.distinctFallbackInformationSets, c.audit.distinctFallbackInformationSets);
    assert.equal(c.distinctEstimates, undefined, 'no estimate is reported while the count is exact');
  }
  assert.deepEqual(rows.map(c => c.distinctInformationSets), [371, 371, 371], 'the RTX 4060 Ti report recorded 371 for 1, 2 and 8 threads');
});

// ============================== CUDA lifecycle (driver test double) ==============================
test('4.3 CUDA: device modes x threads on shared tables — identical EVs, every board once, no context errors, no leaks (Linux CUDA test double)', { skip: fxSkip, timeout: 900000 }, t => {
  const S = fixture(t), env = { LD_LIBRARY_PATH: fx(), EM_GPU_INIT_ESTIMATE_S: '0' };
  for (const device of ['gpu', 'hybrid', 'auto']) for (const threads of [1, 2, 4, 8]) {
    const r = S.ev({ ...EXACT, device, threads, gpuMiB: 2048 }, env), x = r.json && r.json.execution;
    assert.ok(r.json, device + ' ' + threads + ': ' + r.error);
    assert.deepEqual(r.json.hands[0].ev, PUSH8_EV_42, device + ' ' + threads);
    assert.equal(x.boardsScored, 376992); assert.equal(x.cpuBoards + x.gpuBoards, 376992, 'every board scored exactly once');
    assert.deepEqual(x.gpuErrors, []);
    if (device === 'gpu') { assert.equal(x.gpuBoards, 376992 - x.scheduling.gpuVerificationBoards); assert.equal(x.profileSeconds.gpuLockWait, 0, 'one table: nobody waits for the device'); }
    if (r.driver) { assert.equal(r.driver.invalidContextCalls, 0); assert.equal(r.driver.pushes, r.driver.pops); assert.equal(r.driver.liveBytesAtExit, 0); assert.equal(r.driver.contextsAliveAtExit, 0); }
  }
});
test('4.3 CUDA: eight-seat response gains in GPU mode score one table once, CPU threads count patterns of device-scored chunks, no lock waiting (Linux CUDA test double)', { skip: fxSkip }, t => {
  const S = fixture(t);
  const r = S.gain({ method: 'exact', seats: [0, 1, 2, 3, 4, 5, 6, 7], threads: 8, device: 'gpu', timeLimitMs: 600000 }, { LD_LIBRARY_PATH: fx() });
  assert.ok(r.json, r.error); const x = r.json.execution;
  assert.deepEqual(r.json.seats.map(s => s.gain), PUSH8_GAINS_42);
  assert.equal(x.gpuBoards + x.cpuBoards, 376992, '4.2: 2,950,400 GPU boards and 2.5 s of summed lock waiting on this request');
  assert.equal(x.profileSeconds.gpuLockWait, 0); assert.ok(x.tables43.gpuScoredChunksPatternedByCpu > 0);
  assert.equal(r.driver.invalidContextCalls, 0); assert.equal(r.driver.liveBytesAtExit, 0); assert.equal(r.driver.pushes, r.driver.pops);
});
test('4.3 CUDA: fault injection on shared tables (alloc, OOM after N, VRAM pressure, launch, download, mismatch, no primary context, no driver) — identical EVs, correct fallback (Linux CUDA test double)', { skip: fxSkip, timeout: 900000 }, t => {
  const S = fixture(t);
  for (const fault of ['alloc', 'allocAfter=2', 'pressure', 'launch', 'download', 'mismatch', 'noprimary', 'missing', 'slow']) for (const device of ['gpu', 'hybrid']) {
    const r = S.ev({ ...EXACT, device, threads: 4, gpuMiB: 2048 }, { LD_LIBRARY_PATH: fx(), EM_FIXTURE_FAULT: fault });
    assert.ok(r.json, fault + ' ' + device + ': ' + r.error);
    assert.deepEqual(r.json.hands[0].ev, PUSH8_EV_42, fault + ' ' + device);
    const x = r.json.execution; assert.equal(x.cpuBoards + x.gpuBoards, 376992, fault + ': nothing counted twice, nothing omitted');
    if (['alloc', 'allocAfter=2', 'pressure', 'launch', 'download', 'mismatch'].includes(fault) && device === 'gpu') assert.ok(x.gpuErrors.length >= 1, fault + ' is reported');
    if (r.driver) { assert.equal(r.driver.invalidContextCalls, 0, fault); assert.equal(r.driver.liveBytesAtExit, 0, fault); assert.equal(r.driver.pushes, r.driver.pops, fault); }
  }
});
test('4.3 CUDA lifecycle: one process, many requests — one open and one verification, warm reuse, concurrent jobs, idle release, recovery after cancellation and after a budget refusal (Linux CUDA test double)', { skip: fxSkip, timeout: 900000 }, t => {
  const S = fixture(t);
  const plan = path.join(__dirname, '..', 'tools', 'sessions43', 'ev-gpu.json');
  const r = S.session(plan, { LD_LIBRARY_PATH: fx(), EM_GPU_IDLE_RELEASE_S: '1' }); assert.ok(r.json, r.error);
  assert.equal(r.json.mismatches, 0, 'every completed run identical to the first');
  const steps = Object.fromEntries(r.json.steps.map(s => [s.label.split(':')[0].split(' (')[0], s]));
  const results = r.json.steps.flatMap(s => s.runs.flatMap(x => x.results));
  for (const x of results) if (x.status === 200) { assert.deepEqual(JSON.parse(JSON.stringify(x.values)), PUSH8_EV_42); assert.equal(x.cpuBoards + x.gpuBoards, 376992); }
  const last = r.json.steps[r.json.steps.length - 1].gpuAfter;
  assert.equal(last.opens, 1, 'the context is opened once per process'); assert.equal(last.verifications, 1, 'the device is verified once per process');
  assert.ok(steps['cold'].runs[0].results[0].gpuBoards > 0 && steps['warm'].runs[0].results[0].gpuBoards === 376992, 'warm run: every board on the device (no verification boards)');
  assert.ok(steps['after 1.5 s idle'].gpuAfter.idleBufferReleases >= 1, 'idle buffers released');
  assert.equal(steps['after 1.5 s idle'].runs[0].results[0].gpuBoards, 376992, 'device usable after the idle release');
  assert.equal(steps['cancelled after 5 ms'].runs[0].results[0].status, 409);
  assert.equal(steps['after cancellation'].runs[0].results[0].gpuBoards, 376992, 'device usable after cancellation');
  const refused = steps['recoverable refusal'].runs[0].results[0];
  assert.equal(refused.gpuBoards, 0); assert.equal(refused.gpuErrors[0].name, 'EM_GPU_BUDGET_EXCEEDED'); assert.equal(steps['recoverable refusal'].gpuAfter.available, true, 'a refusal does not disable the device');
  assert.equal(steps['after the refusal'].runs[0].results[0].gpuBoards, 376992);
  assert.equal(steps['four concurrent'].runs.flatMap(x => x.results).filter(x => x.status === 200).length, 8);
  assert.equal(r.driver.invalidContextCalls, 0); assert.equal(r.driver.liveBytesAtExit, 0); assert.equal(r.driver.pushes, r.driver.pops); assert.equal(r.driver.primaryRetains, 1, 'one primary-context retain for the whole session');
});
test('4.3 CUDA lifecycle: background start-up and idle janitor (unit phase); Automatic opens the device in the background without stalling a table (Linux CUDA test double)', { skip: fxSkip }, t => {
  const b = compile(t, 'table43', ['-std=c++20', '-O2', '-I' + native, path.join(__dirname, 'table43.cpp'), '-ldl', '-lpthread']); if (b.skip) return t.skip(b.skip);
  const dir = tmp(t), st = path.join(dir, 'fx.json');
  const r = runJson(b.exe, ['lifecycle'], { LD_LIBRARY_PATH: fx(), EM_GPU_IDLE_RELEASE_S: '0.3', EM_FIXTURE_STATS: st }); assert.equal(r.status, 0, r.out + r.err); assert.equal(r.json.failures, 0);
  const d = JSON.parse(fs.readFileSync(st, 'utf8')); assert.equal(d.invalidContextCalls, 0); assert.equal(d.liveBytesAtExit, 0); assert.equal(d.pushes, d.pops);
  // Automatic in one process: early tables on the CPU while the device opens in the background
  const S = fixture(t);
  const plan = path.join(__dirname, '..', 'tools', 'sessions43', 'ev-auto.json');
  const s = S.session(plan, { LD_LIBRARY_PATH: fx(), EM_GPU_INIT_ESTIMATE_S: '0' }); assert.ok(s.json, s.error); assert.equal(s.json.mismatches, 0);
  const first = s.json.steps[0].runs[0].results[0];
  assert.equal(first.profileSeconds.cudaStartup, 0, 'no table waited for CUDA start-up'); assert.ok(first.scheduling.gpuBackgroundOpens >= 1);
  assert.equal(s.json.steps[s.json.steps.length - 1].gpuAfter.opens, 1);
});
test('4.3 desktop host: EM_GPU_PREWARM opens the device in the background and /api/mw/gpu-status reports the lifecycle (Linux CUDA test double)', { skip: fxSkip }, async t => {
  const { withHost, home } = require('./checkpoint_host');
  await withHost(home(t), { LD_LIBRARY_PATH: fx(), EM_GPU_PREWARM: '1' }, async api => {
    let st = null;
    for (let i = 0; i < 100; i++) { st = await (await api('mw/gpu-status')).json(); if (st.attempted) break; await new Promise(r => setTimeout(r, 50)); }
    assert.equal(st.attempted, true); assert.equal(st.available, true); assert.equal(st.backgroundOpens, 1); assert.equal(st.opens, 1);
    assert.equal(st.uses, 0, 'opened before any evaluation used it');
  });
  await withHost(home(t), { LD_LIBRARY_PATH: fx() }, async api => {
    const st = await (await api('mw/gpu-status')).json(); assert.equal(st.attempted, false, 'without EM_GPU_PREWARM the device is not opened at start-up');
  });
});
test('4.3 sanitizers: table43 + coverage43 under ASan+UBSan and TSan; a sanitized mwcli runs shared tables (cpu, gpu, hybrid; EV and 8-seat gains, 8 threads) with no reports (compiler; Linux CUDA test double)', { skip: fxSkip, timeout: 2400000 }, t => {
  const dir = tmp(t);
  for (const [name, flags, env] of [['asan', ['-O1', '-g', '-fsanitize=address,undefined', '-fno-sanitize-recover=all'], { ASAN_OPTIONS: 'detect_leaks=1' }], ['tsan', ['-O1', '-g', '-fsanitize=thread'], { TSAN_OPTIONS: 'halt_on_error=1' }]]) {
    const u = compile(t, 't43_' + name, ['-std=c++20', ...flags, '-I' + native, path.join(__dirname, 'table43.cpp'), '-ldl', '-lpthread']); if (u.skip) return t.skip(u.skip);
    const ru = runJson(u.exe, ['units'], env); assert.equal(ru.status, 0, name + ' table43: ' + ru.err.slice(0, 3000)); assert.doesNotMatch(ru.err, /Sanitizer|runtime error/);
    const c = compile(t, 'c43_' + name, ['-std=c++20', ...flags, '-I' + native, path.join(__dirname, 'coverage43.cpp'), '-lpthread']);
    const rc = runJson(c.exe, ['500000'], env); assert.equal(rc.status, 0, name + ' coverage43: ' + rc.err.slice(0, 3000)); assert.doesNotMatch(rc.err, /Sanitizer|runtime error/);
    // sanitized engine
    const json = path.join(dir, 'json_' + name + '.o'), exe = path.join(dir, 'mwcli_' + name);
    cp.execFileSync('gcc', [...flags.filter(f => f !== '-fno-sanitize-recover=all'), '-c', path.join(native, 'json.c'), '-o', json]);
    cp.execFileSync('g++', ['-std=c++20', ...flags, '-ffp-contract=off', '-I' + native, path.join(native, 'mw.cpp'), path.join(native, 'mwcli.cpp'), json, '-lpthread', '-ldl', '-lz', '-o', exe]);
    let lib = fx();
    if (name === 'tsan') { lib = path.join(dir, 'fxt'); fs.mkdirSync(lib); cp.execFileSync('g++', ['-std=c++20', '-O1', '-g', '-fsanitize=thread', '-shared', '-fPIC', path.join(__dirname, 'cuda_driver_fixture.cpp'), '-o', path.join(lib, 'libcuda.so.1')]); }
    const f = runner(t, path.join(fixtures40, 'push8-icm.spec.json'), path.join(fixtures40, 'push8-icm.state'));
    const run = (mode, q, e2 = {}) => { const qf = path.join(dir, 'q.json'); fs.writeFileSync(qf, JSON.stringify(q)); return cp.spawnSync(exe, [mode, f.spec, f.state, qf], { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, LD_LIBRARY_PATH: lib, ...env, ...e2 } }); };
    // the CUDA test double keeps immortal driver state (allocated at dlopen): leak checks only where it is not loaded
    const noLeak = name === 'asan' ? { ASAN_OPTIONS: 'detect_leaks=0' } : {};
    for (const device of ['cpu', 'gpu', 'hybrid']) {
      const r = run('--ev', { ...EXACT, device, threads: 8 }, device === 'cpu' ? {} : noLeak); assert.equal(r.status, 0, name + ' ' + device + ': ' + r.stderr.slice(0, 3000));
      assert.doesNotMatch(r.stderr, /Sanitizer|runtime error/); assert.deepEqual(JSON.parse(r.stdout).hands[0].ev, PUSH8_EV_42);
    }
    const g = run('--gain', { method: 'exact', seats: [0, 1, 2, 3, 4, 5, 6, 7], threads: 8, device: 'cpu', timeLimitMs: 600000 }); assert.equal(g.status, 0, name + ' gain: ' + g.stderr.slice(0, 3000));
    assert.doesNotMatch(g.stderr, /Sanitizer|runtime error/); assert.deepEqual(JSON.parse(g.stdout).seats.map(s => s.gain), PUSH8_GAINS_42);
    const c2 = run('--ev', { ...EXACT, device: 'cpu', threads: 8 }, { EM_EV_FAULT: 'table:50' }); assert.notEqual(c2.status, 0); assert.doesNotMatch(c2.stderr, /Sanitizer|runtime error/, name + ' cancellation inside cooperative construction');
  }
});
