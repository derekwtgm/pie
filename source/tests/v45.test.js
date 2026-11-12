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

// ============================== Priority 2: process-wide memory ==============================
const hostSkip = !(process.env.EM_TEST_HOST || build.host().exe) && (build.host().why || 'no native host');
async function jsonOf(r) { const text = await r.text(); try { return { http: r.status, ...JSON.parse(text) }; } catch { return { http: r.status, text }; } }
async function until(f, ms = 120000) { const t0 = Date.now(); for (;;) { const v = await f(); if (v) return v; if (Date.now() - t0 > ms) throw Error('timeout'); await new Promise(r => setTimeout(r, 10)); } }
test('4.5 evaluation job pool charges memoryMiB + coverageMiB (4.4 charged memoryMiB only): status shows the charge, an over-pool coverage budget is refused with 413 and creates no job, the pool is released when jobs finish (native host)', { skip: hostSkip, timeout: 600000 }, async t => {
  await withHost(home(t), {}, async api => {
    const spec = E.MultiwayGame({ ...base, preflop: { mode: 'shove' }, board: '', dealt: 8, common: 0, stacks: STACKS8, ranges: ['AsAh', 'KsKh', 'QsQh', 'JsJh', 'TsTh', '9s9h', '8s8h', '7s7h'], icm: { payouts: PAY8 }, batchDeals: 4, actionStreams: 'deal', privateSeed: 4 }).nativeSpec();
    assert.equal((await api('mw/init', JSON.stringify(spec))).status, 200);
    assert.equal((await api('mw/train', { iterations: 100, threads: 2 })).status, 200);
    await until(async () => !(await (await api('mw/status')).json()).running);
    const pool = (await jsonOf(await api('mw/jobs'))); assert.ok(pool.http === 200);
    // defaults: coverageMiB = clamp(memoryMiB / 4, 4, 64)
    // (different seeds so that no request is answered from the result cache of an earlier one)
    for (const [q, cov] of [[{ hands: [0], method: 'sampled', samples: 2000, seed: 1, path: [] }, 64], [{ hands: [0], method: 'sampled', samples: 2000, seed: 2, path: [], memoryMiB: 16 }, 4], [{ hands: [0], method: 'sampled', samples: 2000, seed: 3, path: [], memoryMiB: 64, coverageMiB: 7 }, 7]]) {
      const r = await jsonOf(await api('mw/jobs/ev', q)); assert.equal(r.http, 202, JSON.stringify(q) + ' ' + (r.error || ''));
      const done = await until(async () => { const s = await jsonOf(await api('mw/jobs/' + r.jobId)); return ['completed', 'timedOut', 'failed'].includes(s.status) && s; });
      assert.equal(done.status, 'completed'); assert.equal(done.coverageMiB, cov); assert.equal(done.chargedMiB, (q.memoryMiB || 512) + cov, 'the pool is charged memoryMiB + coverageMiB');
      const res = await jsonOf(await api('mw/jobs/' + r.jobId + '/result')); const mem = (res.result || res).coverage.memory; assert.equal(mem.budgetBytes, cov * MiB); assert.ok(mem.peakBytes <= mem.budgetBytes);
    }
    const before = (await jsonOf(await api('mw/jobs'))).jobs.length;
    // 16 MiB of tables with a 4,096 MiB coverage budget: 4.4 admitted this as a 16 MiB job
    const big = await jsonOf(await api('mw/jobs/ev', { hands: [0], method: 'exact', path: [], memoryMiB: 16, coverageMiB: 4096 }));
    assert.equal(big.http, 413, 'coverage budget above the pool: ' + JSON.stringify(big)); assert.match(big.error, /coverageMiB 4096/);
    assert.equal((await jsonOf(await api('mw/jobs'))).jobs.length, before, 'the refused request created no job');
    for (const bad of ['0', '4097', '1e300', '"8"', 'null', '1.5']) assert.equal((await jsonOf(await api('mw/jobs/ev', '{"hands":[0],"coverageMiB":' + bad + '}'))).http, 400, 'coverageMiB=' + bad);
    // the same rule for response-gain jobs
    assert.equal((await jsonOf(await api('mw/jobs/response-gain', { method: 'exact', memoryMiB: 16, coverageMiB: 4096 }))).http, 413);
    const g = await jsonOf(await api('mw/jobs/response-gain', { method: 'exact', coverageMiB: 2 })); assert.equal(g.http, 202, g.error);
    const gd = await until(async () => { const s = await jsonOf(await api('mw/jobs/' + g.jobId)); return ['completed', 'timedOut', 'failed'].includes(s.status) && s; }); assert.equal(gd.status, 'completed'); assert.equal(gd.chargedMiB, 514);
    assert.equal((await api('info')).status, 200, 'host still answers');
  });
});
test('4.5 memory exhaustion leaves the study untouched: evaluations with a 1 MiB coverage budget (capped), a 16 MiB table budget and a timeout do not change one byte of the trained state, and training then continues bit-identically to an uninterrupted run', { skip, timeout: 900000 }, t => {
  const dir = tmp(t), spec = path.join(dir, 'spec.json'), sha = f => require('node:crypto').createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  fs.writeFileSync(spec, JSON.stringify(E.MultiwayGame(studies.icmFinal).nativeSpec()));
  const train = (n, out, from) => JSON.parse(cp.execFileSync(tool(), [spec, n, 2, out, 512, ...(from ? [from] : [])].map(String), { encoding: 'utf8' }));
  const a = path.join(dir, 'a.state'), b = path.join(dir, 'b.state'), c = path.join(dir, 'c.state');
  train(120, a); const before = sha(a); const R = runner(t, spec, a);
  const capped = R.ev({ path: [], hands: [3], range: true, method: 'sampled', samples: 30000, seed: 5, threads: 4, coverageMiB: 1, timeLimitMs: 600000 }); assert.equal(capped.json.coverage.memory.status, 'keyLimitReached');
  const small = R.ev({ path: [], hands: [3], method: 'sampled', samples: 4000, seed: 5, threads: 4, memoryMiB: 16, coverageMiB: 1, timeLimitMs: 600000 }); assert.ok(small.json, small.error);
  const late = R.ev({ ...AUDIT, timeLimitMs: 100, threads: 4, coverageMiB: 1 }); assert.equal(late.json.status, 'partial');
  const gain = R.gain({ method: 'sampled', samples: 100, seed: 3, threads: 4, coverageMiB: 1, timeLimitMs: 600000 }); assert.equal(gain.status, 0, gain.error);
  assert.equal(sha(a), before, 'evaluations (capped coverage, small table budget, timeout, response gain) never write the study');
  const i1 = train(120, b, a), i2 = train(240, c);
  assert.equal(i1.iterations, 240); assert.equal(i2.iterations, 240); assert.equal(i1.trainingDeals, i2.trainingDeals); assert.equal(i1.rng, i2.rng); assert.equal(i1.actionRng, i2.actionRng);
  assert.equal(sha(b), sha(c), 'resumed after the evaluations == uninterrupted run, byte for byte');
});

// ============================== Priority 3: IEEE 754 round trips ==============================
test('4.5 IEEE 754 sweep: 200,000 generated doubles (any finite pattern, EV-sized, subnormal, +-3 ULP around every power of two, huge, around 2^53) print with 17 digits and parse back to identical bits through the engine parser and the JSON reader; one-ULP neighbours print differently; the digest equals the recorded reference', { skip }, t => {
  const r = cp.spawnSync(tool(), ['--ieee-sweep', '200000', '45'], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stdout + r.stderr);
  const d = JSON.parse(r.stdout); assert.equal(d.passed, true); assert.equal(d.count, 200000);
  for (const k of ['parserMismatches', 'jsonReaderMismatches', 'neighbourTextCollisions', 'neighbourMismatches', 'worstUlpDistance']) assert.equal(d[k], 0, k);
  assert.equal(Object.values(d.classes).reduce((a, b) => a + b, 0), 200000); for (const n of Object.values(d.classes)) assert.ok(n >= 33333);
  assert.equal(d.digest, '94fc3f6ed8426909', 'the same characters as the 4.5 Linux and Windows (Wine) builds printed');
  // another seed gives another digest (the digest is not constant) and still no mismatch
  const d2 = JSON.parse(cp.spawnSync(tool(), ['--ieee-sweep', '50000', '7'], { encoding: 'utf8' }).stdout); assert.equal(d2.passed, true); assert.notEqual(d2.digest, d.digest);
  for (const bad of [['--ieee-sweep', '0'], ['--ieee-sweep', '-5'], ['--ieee-sweep', '50000001']]) assert.equal(cp.spawnSync(tool(), bad, { encoding: 'utf8' }).status, 2);
  // the values the MinGW-w64 strtod was measured to mis-round (just below 2^-742, 2^-701, 2^-505, 2^652): engine reader, bits exact
  const probes = [-742, -701, -505, 652, 1023, -1022].flatMap(e => [0n, 1n].map(sign => { const bits = ((BigInt(e + 1023) << 52n) - 1n) | (sign << 63n); const h = bits.toString(16).padStart(16, '0'); const b = Buffer.from(h, 'hex'); const v = b.readDoubleBE(); return { name: 'below 2^' + e, bits: h, value: v, text: String(v) }; }));
  const f = path.join(tmp(t), 'p.json'); fs.writeFileSync(f, JSON.stringify({ probes }));
  const v = cp.spawnSync(tool(), ['--ieee-verify', f], { encoding: 'utf8' }); assert.equal(v.status, 0, v.stdout + v.stderr);
  const rep = JSON.parse(v.stdout); assert.equal(rep.probeCount, probes.length); assert.equal(rep.mismatches, 0); assert.equal(rep.textMismatches, 0);
});

// ============================== Priority 5: experimental trainer options ==============================
test('4.5 trainer options: the default trainer still writes the 4.4 state bytes (recorded hash); chanceSampling latin and opponentExploration are opt-in, validated, native-only, deterministic and continue bit-identically from a checkpoint', { skip, timeout: 600000 }, t => {
  const dir = tmp(t), sha = f => require('node:crypto').createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const mk = (name, extra) => { const f = path.join(dir, name + '.spec.json'); fs.writeFileSync(f, JSON.stringify(E.MultiwayGame({ ...studies.icmFinal, ...extra }).nativeSpec())); return f; };
  const train = (spec, n, out, from, threads = 4) => JSON.parse(cp.execFileSync(tool(), [spec, n, threads, out, 512, ...(from ? [from] : [])].map(String), { encoding: 'utf8' }));
  const def = mk('default', {}), st = n => path.join(dir, n + '.state');
  train(def, 300, st('def'));
  assert.equal(sha(st('def')), 'aa80974199182afa91d5a47166d32af0eb00ecff3ba334593eb5a359cc2e22b8', 'eight-seat linked ICM study, 300 updates, 4 threads: the state file of the 4.4 build (the ICM kernel and the option plumbing changed no bit)');
  assert.ok(!('chanceSampling' in JSON.parse(fs.readFileSync(def, 'utf8'))), 'the default specification does not mention the new options');
  // explicit defaults are the default
  train(mk('explicit', { chanceSampling: 'independent', opponentExploration: 0.1 }), 300, st('explicit')); assert.equal(sha(st('explicit')), sha(st('def')));
  // latin: different sample path, same bookkeeping, deterministic, resumable
  const lat = mk('latin', { chanceSampling: 'latin' }); assert.equal(JSON.parse(fs.readFileSync(lat, 'utf8')).chanceSampling, 'latin');
  const l1 = train(lat, 200, st('l1')), l2 = train(lat, 200, st('l2')); assert.equal(sha(st('l1')), sha(st('l2')), 'deterministic'); assert.notEqual(sha(st('l1')), sha(st('def')));
  assert.equal(l1.trainingDeals, 800); assert.equal(l1.iterations, 200);
  train(lat, 80, st('l3a')); const l3 = train(lat, 120, st('l3b'), st('l3a')); assert.equal(l3.iterations, 200); assert.equal(sha(st('l3b')), sha(st('l1')), 'latin: 80 + 120 updates == 200 updates, byte for byte (the permutations depend only on the seed and the deal number)');
  train(lat, 200, st('l4'), undefined, 1); assert.equal(sha(st('l4')), sha(st('l1')), 'latin: identical for 1 and 4 threads');
  // exploration: opt-in, deterministic
  const ex = mk('explore', { opponentExploration: 0.05 }); train(ex, 100, st('e1')); train(ex, 100, st('e2')); assert.equal(sha(st('e1')), sha(st('e2')));
  // validation in the specification builder and in the native reader
  assert.throws(() => E.MultiwayGame({ ...studies.icmFinal, chanceSampling: 'sobol' }), /chance sampling/);
  for (const v of [-0.1, 0.6, '0.1', NaN]) assert.throws(() => E.MultiwayGame({ ...studies.icmFinal, opponentExploration: v }), /exploration/);
  const raw = JSON.parse(fs.readFileSync(def, 'utf8'));
  for (const [k, v] of [['chanceSampling', 'sobol'], ['chanceSampling', 5], ['opponentExploration', 0.7], ['opponentExploration', '0.1']]) {
    const f = path.join(dir, 'bad.json'); fs.writeFileSync(f, JSON.stringify({ ...raw, [k]: v }));
    const r = cp.spawnSync(tool(), [f, '10', '1', path.join(dir, 'bad.state'), '512'], { encoding: 'utf8' }); assert.notEqual(r.status, 0, k + '=' + v + ' must be refused by the native reader');
  }
  // the JavaScript trainer refuses a study that needs the native-only option (no silent divergence)
  assert.throws(() => E.MultiwayGame({ ...studies.icmFinal, chanceSampling: 'latin' }).iterate(1), /native/);
  assert.doesNotThrow(() => E.MultiwayGame({ ...studies.icmFinal, batchDeals: 1, privateSeed: 9, stacks: [10, 10, 10, 10, 10, 10, 10, 10] }).iterate(1));
});

// ============================== Priorities 6 and 10: ICM kernel, side pots ==============================
test('4.5 ICM kernel: the two-lane routine returns the identical bit pattern as the archived 4.4 scalar routine on 240,000 random evaluations (2-8 players, busted players, ties, other tables, short payouts, tiny and huge stacks); also under ASan+UBSan (compiler)', { skip, timeout: 900000 }, t => {
  const b = compile(t, 'icm45', ['-std=c++20', '-O2', '-ffp-contract=off', '-I' + native, '-I' + __dirname, path.join(__dirname, 'icm45.cpp')]); if (b.skip) return t.skip(b.skip);
  const r = runJson(b.exe, ['60000']); assert.equal(r.status, 0, r.out + r.err); assert.equal(r.json.evaluations, 240000); assert.equal(r.json.bitMismatchesAgainst44, 0); assert.equal(r.json.cacheHitMismatches, 0); assert.equal(r.json.prizeSumErrors, 0); assert.equal(r.json.singleStackCheck, true);
  if (linux) {
    const s = compile(t, 'icm45s', ['-std=c++20', '-O1', '-g', '-fsanitize=address,undefined', '-fno-sanitize-recover=undefined', '-ffp-contract=off', '-I' + native, '-I' + __dirname, path.join(__dirname, 'icm45.cpp')]);
    const rs = runJson(s.exe, ['4000']); assert.equal(rs.status, 0, rs.err.slice(0, 2000)); assert.doesNotMatch(rs.err, /Sanitizer|runtime error/); assert.equal(rs.json.bitMismatchesAgainst44, 0);
  }
});
test('4.5 property test, side pots and chip conservation: 16 generated all-in-or-fold river games (3-6 players, random unequal stacks, earlier wagers, folded money, weighted ranges): exact seat values sum to the starting pot, every unilateral gain is >= 0, results are bit-identical for 1 and 4 threads; the same games with ICM payouts sum to the prize pool', { skip, timeout: 900000 }, t => {
  let seed = 4545; const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  const ranks = 'AKQJT98765432', suits = 'shdc', board = ['Ks', '8d', '5h', '2c', '2s'], dir = tmp(t);
  const q = { method: 'exact', timeLimitMs: 600000, maxVisits: 2000000000 };
  for (let game = 0; game < 16; game++) {
    const n = 3 + Math.floor(rnd() * 4), used = new Set(board), ranges = [];
    for (let p = 0; p < n; p++) {
      const hands = [];
      while (hands.length < 2) { const a = ranks[Math.floor(rnd() * 13)] + suits[Math.floor(rnd() * 4)], b = ranks[Math.floor(rnd() * 13)] + suits[Math.floor(rnd() * 4)]; if (a === b || used.has(a) || used.has(b)) continue; used.add(a); used.add(b); hands.push(a + b + (rnd() < 0.4 ? ':' + (0.25 + 0.5 * rnd()).toFixed(2) : '')); }
      ranges.push(hands.join(','));
    }
    const stacks = Array.from({ length: n }, () => +(1 + Math.floor(rnd() * 60) / 2).toFixed(1)), prior = +(1 + Math.floor(rnd() * 6) / 2).toFixed(1), icm = game % 4 === 3;
    const cfg = { ...base, board: board.join(''), common: +(rnd() * 4).toFixed(1), stacks, prior: Array(n).fill(prior), folded: !icm && rnd() < 0.5 ? [prior, 1] : [], ranges, streets: { river: { bets: 'a', raises: '', maxBets: 1 } }, privateSeed: 1 + game,
      ...(icm ? { icm: { payouts: Array.from({ length: n }, (_, i) => 10 * (n - i)) } } : {}) };
    const spec = path.join(dir, 'g' + game + '.json'), state = path.join(dir, 'g' + game + '.state'), specJson = E.MultiwayGame(cfg).nativeSpec();
    fs.writeFileSync(spec, JSON.stringify(specJson)); cp.execFileSync(tool(), [spec, 200, 2, state, 512].map(String), { encoding: 'utf8' });
    const R = runner(t, spec, state), g1 = R.gain({ ...q, threads: 1 }), g4 = R.gain({ ...q, threads: 4 }); assert.ok(g1.json && g4.json, 'game ' + game + ': ' + g1.error + g4.error);
    const total = g1.json.seats.reduce((a, s) => a + s.policyValue, 0), want = icm ? cfg.icm.payouts.reduce((a, b) => a + b, 0) : specJson.rules.pot0;
    assert.ok(Math.abs(total - want) <= 1e-9 * Math.max(1, want), `game ${game} (${n} players, stacks ${stacks}, ${icm ? 'ICM' : 'chip EV'}): seat values sum to ${total}, expected ${want}`);
    for (const s of g1.json.seats) assert.ok(s.gain >= -1e-9, `game ${game} seat ${s.seat}: gain ${s.gain}`);
    assert.deepEqual(g4.json.seats.map(s => s.gainBits), g1.json.seats.map(s => s.gainBits), 'game ' + game + ': bit-identical for 1 and 4 threads');
    if (!icm) assert.ok(Math.abs(specJson.rules.pot0 - (cfg.common + n * prior + cfg.folded.reduce((a, b) => a + b, 0))) < 1e-9, 'starting pot = common + earlier wagers + folded money');
  }
});
