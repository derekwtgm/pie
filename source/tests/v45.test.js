'use strict';
// EightMax 4.5 regression tests.
//
// Priority 1 (release blocker) - strict memory budget of the strategy-coverage
//   component. tests/coverage45.cpp reproduces the audited 4.4 overrun against the
//   archived 4.4 header (1 MiB allowance, 32,768 information sets: 1,425,408 bytes)
//   and checks the 4.5 ledger: 1/2/8/32 MiB, 1-16 workers, forced collisions,
//   repeated growth, cancellation during growth, ledger exhaustion, failed
//   allocation, lock-free readers during resizing, destruction, repeated jobs.
//   The evaluator tests below check the same ceiling end to end (coverage.memory in
//   every action-EV and response-gain answer) and that EVs are unaffected.
// Further priorities are appended below (see the section headers).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
const E = require('../tools/loadlib');
for (const l of ['lib_runouts', 'lib_wide', 'lib_river', 'lib_pushfold', 'lib_explorer']) require('../web/' + l);
const { withHost, home } = require('./checkpoint_host');
const build = require('./native_build');
const native = path.join(__dirname, '..', 'native');
const fixtures40 = path.join(__dirname, '..', '..', 'validation', '4.0', 'fixtures');
const tool = () => process.env.EM_TEST_MWCLI || build.cli().cli;
const skip = !tool() && (build.cli().why || 'no native CLI');
const linux = process.platform === 'linux';
const fx = () => build.cli().fixtureDir;
const fxSkip = !(linux && tool() && build.cli().fixtureDir) && 'needs the Linux CUDA driver test double (simulated driver; no physical GPU)';
const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'em45-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const bitsOf = x => { const b = Buffer.alloc(8); b.writeDoubleBE(x); return b.toString('hex'); };
const ordinal = h => { const u = BigInt('0x' + h); return u >> 63n ? -(u & 0x7fffffffffffffffn) : u; };
const ulp = (a, b) => { const d = ordinal(a) - ordinal(b); return d < 0n ? -d : d; };
const PUSH8_EV_BITS = ['402e0a51470d8f36', '402f57218439052d'];   // 15.020151348500445, 15.670177585564113 (4.2 reference)
const PUSH8_GAIN_BITS = ['3fe15d3f18fd8430', '3fadfb44a17da100', '3f7e93e0e23e9000', '3fa28aad598de200', '3fc1d3a932e4eb40', '3facf6d893a40500', '3fbb34236bb44e80', '3fc12dd7abd36dc0'];
const PUSH8_GAINS_42 = [0.54263262635152465, 0.05855764838526234, 0.0074652466318276822, 0.036214272672570047, 0.13927187905377458, 0.056570785543962998, 0.10626431827068394, 0.13421150102554513];
const base = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128 };
const STACKS8 = [30, 22, 15, 40, 9, 18, 25, 12], PAY8 = [30, 20, 14, 11, 9, 7, 5, 4];
const studies = {
  // the audit's deadline case (tests/v40.test.js icmFinal): eight seats, random ranges, linked preflop-to-river, ICM
  icmFinal: { ...base, preflop: { mode: 'linked', opens: '2.2,a', raises: 'a', maxBets: 2 }, board: '', dealt: 8, common: 0, stacks: STACKS8, ranges: Array(8).fill('random'), icm: { payouts: PAY8 }, streets: { flop: { bets: '50', raises: '', maxBets: 1 }, turn: { bets: 'a', raises: '', maxBets: 1 }, river: { bets: 'a', raises: '', maxBets: 1 } }, batchDeals: 4, actionStreams: 'deal', privateSeed: 4 },
};
function runner(t, spec, state) {
  const dir = tmp(t); let n = 0;
  const run = (mode, query, env = {}, file) => {
    const q = path.join(dir, 'q' + (n++) + '.json'), stats = path.join(dir, 'fx' + n + '.json'); fs.writeFileSync(q, typeof query === 'string' ? query : JSON.stringify(query));
    const r = cp.spawnSync(tool(), [mode, spec, state, file || q], { encoding: 'utf8', maxBuffer: 1 << 27, env: { ...process.env, EM_QUERY_TIMING: '1', EM_FIXTURE_STATS: stats, ...env }, timeout: 300000 });
    const lines = (r.stderr || '').trim().split('\n'); let timing = null; try { timing = JSON.parse(lines[0]); } catch { }
    const driver = fs.existsSync(stats) ? JSON.parse(fs.readFileSync(stats, 'utf8')) : null;
    let json = null; if (r.status === 0) { try { json = JSON.parse(r.stdout); } catch { } }
    return { json, raw: r.stdout, error: lines.slice(timing ? 1 : 0).join('\n').trim(), status: r.status, timing, driver };
  };
  return { dir, spec, state, run, ev: (q, env) => run('--ev', q, env), gain: (q, env) => run('--gain', q, env), session: (planFile, env) => run('--session', '{}', env, planFile) };
}
const fixture = t => runner(t, path.join(fixtures40, 'push8-icm.spec.json'), path.join(fixtures40, 'push8-icm.state'));
function study(t, name, iterations, threads = 2) {
  const dir = tmp(t), spec = path.join(dir, 'spec.json'), state = path.join(dir, 'state');
  fs.writeFileSync(spec, JSON.stringify(E.MultiwayGame(studies[name]).nativeSpec()));
  cp.execFileSync(tool(), [spec, iterations, threads, state, 512].map(String), { encoding: 'utf8' });
  return runner(t, spec, state);
}
function compile(t, name, args) {
  const exe = path.join(tmp(t), name);
  const r = cp.spawnSync('g++', [...args, '-o', exe], { encoding: 'utf8' });
  if (r.error) return { skip: 'C++ compiler unavailable' };
  assert.equal(r.status, 0, r.stderr);
  return { exe };
}
const runJson = (exe, args = [], env = {}) => { const r = cp.spawnSync(exe, args, { encoding: 'utf8', maxBuffer: 1 << 27, env: { ...process.env, ...env }, timeout: 900000 }); let json = null; try { json = JSON.parse(r.stdout); } catch { } return { status: r.status, json, out: r.stdout, err: r.stderr }; };
const EXACT = { path: [], hands: [0], method: 'exact', maxVisits: 2000000000, timeLimitMs: 600000 };
const TOLERANCE_IDLE_MS = 50, TOLERANCE_LOADED_MS = 150;   // unchanged from 4.0
const AUDIT = { path: [], hands: [3], range: true, method: 'sampled', samples: 2000000 };


// ============================== Priority 1: strict coverage memory budget ==============================
const MiB = 1 << 20;
test('4.5 coverage budget (unit): the archived 4.4 table allocates 1,425,408 bytes for a 1 MiB allowance; the 4.5 ledger never exceeds the budget (1-32 MiB, 1-16 workers, collisions, cancellation, exhaustion, failed allocation, readers during resizing, repeated jobs) (compiler)', { skip: skip, timeout: 900000 }, t => {
  const b = compile(t, 'coverage45', ['-std=c++20', '-O2', '-I' + native, '-I' + __dirname, path.join(__dirname, 'coverage45.cpp'), '-lpthread']); if (b.skip) return t.skip(b.skip);
  const r = runJson(b.exe); assert.equal(r.status, 0, (r.json ? JSON.stringify(r.json.checks.filter(c => !c.passed)) : r.err).slice(0, 4000));
  const checks = r.json.checks; assert.equal(r.json.failures, 0); assert.ok(checks.length >= 45, 'checks: ' + checks.length);
  const ref = checks.find(c => /^REFERENCE 4\.4 \(archived header\)/.test(c.check));
  assert.equal(ref.allocatedBytes44, 1425408); assert.equal(ref.allowanceBytes, 1048576); assert.ok(Math.abs(ref.overPercent - 35.9375) < 1e-9);
  const repro = checks.filter(c => /^4\.5: 1 MiB budget, 32,768 information sets/.test(c.check)); assert.equal(repro.length, 8);
  for (const c of repro) { assert.ok(c.peakBytes <= 1048576, c.check + ': ' + c.peakBytes); assert.equal(c.distinct, 32768); assert.equal(c.status, 'ok'); assert.ok(c.promotions >= 2); assert.ok(c.retiredTierBytes > 0, 'retired generations are in the ledger'); }
  // every check that reports a ledger stays within it
  for (const c of checks) if (c.budgetBytes && c.peakBytes !== undefined) assert.ok(c.peakBytes <= c.budgetBytes, c.check);
});
test('4.5 coverage budget (unit) under ThreadSanitizer and ASan+UBSan with no reports (compiler)', { skip: !linux && 'Linux', timeout: 1800000 }, t => {
  for (const [name, flags, env] of [['tsan', ['-fsanitize=thread'], { TSAN_OPTIONS: 'halt_on_error=1' }], ['asan', ['-fsanitize=address,undefined', '-fno-sanitize-recover=undefined'], {}]]) {
    const b = compile(t, 'cov45_' + name, ['-std=c++20', '-O1', '-g', ...flags, '-I' + native, '-I' + __dirname, path.join(__dirname, 'coverage45.cpp'), '-lpthread']); if (b.skip) return t.skip(b.skip);
    const r = name === 'tsan' ? (() => { const x = cp.spawnSync('setarch', ['-R', b.exe, 'quick'], { encoding: 'utf8', maxBuffer: 1 << 27, env: { ...process.env, ...env }, timeout: 900000 }); let json = null; try { json = JSON.parse(x.stdout); } catch { } return { status: x.status, json, err: x.stderr }; })() : runJson(b.exe, ['quick'], env);
    assert.equal(r.status, 0, name + ': ' + (r.err || '').slice(0, 3000)); assert.equal(r.json.failures, 0); assert.doesNotMatch(r.err || '', /Sanitizer|runtime error/);
  }
});
test('4.5 coverage budget (evaluator): coverage.memory.peakBytes <= coverageMiB for 1, 2, 8 and 32 MiB and 1-8 threads; counts identical for every thread count; EVs unchanged by the budget; capped counts are labelled lower bounds with a named status', { skip, timeout: 900000 }, t => {
  const F = study(t, 'icmFinal', 20, 2);
  const q = { path: [], hands: [3], range: true, method: 'sampled', samples: 30000, seed: 5, timeLimitMs: 600000 };
  const evs = new Set();
  for (const mib of [1, 2, 8, 32]) {
    const rows = new Set();
    for (const threads of [1, 2, 4, 8]) {
      const r = F.ev({ ...q, threads, coverageMiB: mib }).json; assert.equal(r.status, 'completed');
      const c = r.coverage, m = c.memory;
      assert.equal(m.budgetBytes, mib * MiB); assert.ok(m.peakBytes > 0 && m.peakBytes <= m.budgetBytes, `${mib} MiB, ${threads} threads: peak ${m.peakBytes}`);
      assert.equal(m.withinBudget, true); assert.ok(m.liveBytes <= m.peakBytes); assert.ok(m.tableBytes + m.workerFilterBytes <= m.peakBytes, 'the set and the filters are part of the ledger');
      assert.equal(m.refusedReservations, 0, 'the planned tiers always fit: nothing was refused');
      assert.equal(c.capacity.exactKeyLimit, mib * MiB / 32, 'the documented capacity (32 bytes a key) is kept inside the ceiling');
      assert.equal(m.countsExact, c.distinctCountKind === 'exact');
      if (c.distinctCountKind === 'lowerBound') { assert.equal(m.status, 'keyLimitReached'); assert.equal(c.distinctInformationSets, c.capacity.exactKeyLimit); assert.ok(c.distinctEstimates.distinctInformationSets >= c.distinctInformationSets); assert.equal(c.distinctCountCapped, true); }
      else assert.equal(m.status, 'ok');
      rows.add([c.policyLookups, c.storedLookups, c.fallbackLookups, c.distinctInformationSets, c.distinctStoredInformationSets, c.distinctFallbackInformationSets, c.distinctCountKind].join('|'));
      evs.add(JSON.stringify(r.range.ev));
    }
    // lower bounds of a capped set depend on which keys arrived first; exact sets must agree exactly
    const kinds = [...rows].map(x => x.split('|')[6]);
    if (kinds.every(k => k === 'exact')) assert.equal(rows.size, 1, `${mib} MiB: identical counts for 1-8 threads:\n` + [...rows].join('\n'));
    else assert.equal(new Set([...rows].map(x => x.split('|').slice(0, 4).join('|'))).size, 1, 'lookups and the capped distinct count (= the limit) do not depend on the thread count');
  }
  assert.equal(evs.size, 1, 'the coverage budget never changes an EV');
  // 1 MiB really is exceeded by this request (the test is not vacuous), 32 MiB is not
  const small = F.ev({ ...q, threads: 4, coverageMiB: 1 }).json.coverage, large = F.ev({ ...q, threads: 4, coverageMiB: 32 }).json.coverage;
  assert.equal(small.distinctCountKind, 'lowerBound'); assert.equal(large.distinctCountKind, 'exact'); assert.ok(large.distinctInformationSets > 32768);
  assert.ok(small.memory.generations >= 3 && small.memory.retiredGenerationBytes > 0, 'several table generations were live and all are accounted');
});
test('4.5 coverage budget (evaluator): a timeout during growth leaves a consistent exact set within budget; the 4.3 merged-table path and the per-seat response-gain tables stay inside coverageMiB as well', { skip, timeout: 900000 }, t => {
  const F = study(t, 'icmFinal', 20, 2);
  for (const ms of [100, 250]) {
    const r = F.ev({ ...AUDIT, timeLimitMs: ms, threads: 4, seed: 5, coverageMiB: 8 }, { EM_COVERAGE_AUDIT: '1' }).json; assert.equal(r.status, 'partial');
    const c = r.coverage; assert.ok(c.memory.peakBytes <= 8 * MiB); assert.equal(c.memory.withinBudget, true);
    if (c.distinctCountKind === 'exact') assert.equal(c.distinctInformationSets, c.audit.distinctInformationSets, 'after a timeout the set equals the audit of every lookup made');
    else assert.ok(c.distinctInformationSets <= c.audit.distinctInformationSets);
  }
  const merged = F.ev({ path: [], hands: [3], range: true, method: 'sampled', samples: 30000, seed: 5, timeLimitMs: 600000, threads: 4, coverageMiB: 1 }, { EM_EV_MERGED_COVERAGE: '1' }).json.coverage;
  assert.match(merged.structure, /merged after the workers stop/); assert.ok(merged.memory.peakBytes <= MiB, 'worker tables + merged table + sketches: ' + merged.memory.peakBytes); assert.equal(merged.distinctCountKind, 'lowerBound');
  // response gain: eight per-seat tables share one 1 MiB pool (slots and sketches); each stays a labelled lower bound
  const g = F.gain({ method: 'sampled', samples: 200, seed: 3, threads: 4, coverageMiB: 1, timeLimitMs: 600000 }); assert.equal(g.status, 0, g.error);
  assert.equal(g.json.seats.length, 8); let keys = 0;
  for (const s of g.json.seats) { assert.ok(Number.isFinite(s.gain.mean)); keys += s.distinctInformationSets; if (s.distinctInformationSets >= 8192) assert.equal(s.distinctCountKind, 'lowerBound'); }
  assert.ok(keys * 32 <= MiB, 'per-seat tables together hold at most coverageMiB / 32 bytes of keys: ' + keys);
});
