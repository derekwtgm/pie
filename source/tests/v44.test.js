'use strict';
// EightMax 4.4 regressions.
//
// Priority 1 - numerical validation. The 4.3 Windows self-test failed with
// 15.670177585564112 where the engine printed 15.670177585564113. Cause:
// Windows PowerShell 5.1 parses a JSON fraction as System.Decimal and the test
// cast it to [double] (two roundings). These tests pin the engine side:
//   * IEEE 754 probe table: native print (%.17g) -> native parse -> identical
//     bits; the same digits parsed by JavaScript (an independent, correctly
//     rounding reader) give the same bits; one-ULP neighbours stay distinct;
//   * evBits / gainBits equal the bits of the printed numbers and the 4.2
//     reference patterns, for every thread count and table mode;
//   * the desktop API serves the same probe document as the CLI;
//   * tools/ps_number_model.py (an arithmetic model of the PowerShell 5.1
//     chain, not a PowerShell run) changes exactly the value the 4.3 report
//     showed changed, by exactly one ULP;
//   * tools/test_windows.ps1 no longer compares re-formatted numbers.
// Comparison policy (validation/4.4/NUMERIC-POLICY.md): bit-exact where the
// specification says results are identical (exact EVs and exact gains across
// threads, devices, table modes and releases; integer counters; hashes);
// stated tolerances elsewhere (sampled estimates: statistical; references
// computed by a different summation order: relative 1e-12).
//
// Priority 2 - sampled-EV deadline. 4.3 merged per-worker coverage tables after
// the workers stopped (8-98 ms after the deadline, growing with the limit and
// the thread count). 4.4 fills one concurrent set while the workers run.
//   * the audit's request (eight handed, range sampled) at 100/250/600/1000 ms
//     and 1-8 threads returns a labelled partial estimate within the tolerance;
//   * the time between the published stop and the response is bounded and does
//     not grow with the limit; under CPU load the loaded tolerance holds;
//   * partial results: only completed samples, equal weights, counts reported;
//   * coverage is identical with the 4.3 merge path and for every thread count.
// DEADLINE TOLERANCES (unchanged from 4.0, tests/v40.test.js): limit + 50 ms on
// an idle machine, limit + 150 ms on a loaded one. Measured on the 4-core
// build machine (validation/4.4/deadline/): worst overrun 21.5 ms over 144
// runs, 1-24 threads (4.3: up to 200 ms).
//
// Priority 4 - Automatic CPU/GPU arms (measured whole-table times): pure
// decision tests (tests/auto44.cpp) and a warm session on the Linux CUDA driver
// test double (SIMULATED driver, no physical GPU).
// Priority 8 - tests/coverage44.cpp (also under ThreadSanitizer).
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
const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'em44-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
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

// ============================== Priority 1: IEEE 754 value preservation ==============================
test('4.4 IEEE 754 probes: native %.17g output parses back to identical bit patterns (native reader and JavaScript), one-ULP neighbours stay distinct', { skip }, t => {
  const dir = tmp(t), r = cp.spawnSync(tool(), ['--ieee'], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(r.stdout); assert.ok(doc.probes.length >= 24);
  for (const p of doc.probes) {
    assert.match(p.bits, /^[0-9a-f]{16}$/);
    assert.equal(bitsOf(p.value), p.bits, 'JSON number parsed by JavaScript: ' + p.name);
    assert.equal(bitsOf(Number(p.text)), p.bits, 'digit string parsed by JavaScript: ' + p.name);
    assert.ok(Number.isFinite(p.value));
  }
  // raw tokens: the number and the string carry the same characters (no conversion at all)
  const tokens = [...r.stdout.matchAll(/"bits":"([0-9a-f]{16})","value":([^,}]+),"text":"([^"]+)"/g)];
  assert.equal(tokens.length, doc.probes.length); for (const m of tokens) assert.equal(m[2], m[3]);
  // classes of values covered
  const v = doc.probes.map(p => p.value);
  assert.ok(v.some(x => x < 0) && v.some(x => x > 0 && x < 2.3e-308) && v.some(x => x > 1e300) && v.some(x => Math.abs(x) === 5e-324), 'negative, subnormal, huge and the smallest subnormal');
  // one-ULP neighbours of the affected EV
  const ref = '402f57218439052d', below = doc.probes.find(p => p.bits === '402f57218439052c'), above = doc.probes.find(p => p.bits === '402f57218439052e');
  assert.equal(ulp(ref, below.bits), 1n); assert.equal(ulp(ref, above.bits), 1n);
  assert.equal(below.text, '15.670177585564112', 'the value the 4.3 Windows report showed is the neighbouring double');
  assert.equal(doc.probes.find(p => p.bits === ref).text, '15.670177585564113');
  assert.notEqual(below.text, doc.probes.find(p => p.bits === ref).text, '17 significant digits distinguish neighbours');
  assert.equal(ulp('c02f57218439052d', 'c02f57218439052c'), 1n); assert.equal(ulp('0000000000000001', '8000000000000000'), 1n, '-0 and the smallest subnormal are one apart');
  // native print -> native parse
  const f = path.join(dir, 'probe.json'); fs.writeFileSync(f, r.stdout);
  const v1 = cp.spawnSync(tool(), ['--ieee-verify', f], { encoding: 'utf8' }); assert.equal(v1.status, 0, v1.stderr);
  const rep = JSON.parse(v1.stdout); assert.equal(rep.probeCount, doc.probes.length); assert.equal(rep.mismatches, 0); assert.equal(rep.textMismatches, 0); assert.equal(rep.worstUlpDistance, 0);
  // a UTF-8 byte-order mark (Windows PowerShell 5.1 Set-Content -Encoding UTF8) is accepted
  fs.writeFileSync(f, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(r.stdout)]));
  assert.equal(cp.spawnSync(tool(), ['--ieee-verify', f], { encoding: 'utf8' }).status, 0);
  // the verifier detects a one-ULP change (it is not vacuous): replace the reference digits by the neighbour's
  fs.writeFileSync(f, r.stdout.replace('"value":15.670177585564113', '"value":15.670177585564112'));
  const bad = cp.spawnSync(tool(), ['--ieee-verify', f], { encoding: 'utf8' }); assert.equal(bad.status, 1, 'a one-ULP difference fails the verification');
  const badRep = JSON.parse(bad.stdout); assert.equal(badRep.mismatches, 1); assert.equal(badRep.worstUlpDistance, 1);
  // malformed documents are refused
  fs.writeFileSync(f, '{"probes":[{"bits":"xyz","value":1}]}'); assert.equal(cp.spawnSync(tool(), ['--ieee-verify', f], { encoding: 'utf8' }).status, 2);
});
test('4.4 exact EVs and exact response gains carry IEEE 754 bit patterns equal to the printed numbers and to the 4.2 reference, for every thread count and table mode', { skip }, t => {
  const S = fixture(t); const seen = new Set();
  for (const [threads, env] of [[1, {}], [2, {}], [4, {}], [8, {}], [4, { EM_EV_PRIVATE_TABLES: '1' }], [2, { EM_EV_DIRECT_PATTERNS: '1' }], [2, { EM_EV_MERGED_COVERAGE: '1' }]]) {
    const r = S.ev({ ...EXACT, device: 'cpu', threads }, env); assert.ok(r.json, r.error);
    const h = r.json.hands[0];
    assert.deepEqual(h.evBits, PUSH8_EV_BITS, threads + ' threads ' + JSON.stringify(env));
    assert.deepEqual(h.ev.map(bitsOf), h.evBits, 'the printed numbers are the same doubles');
    // raw output: the digits the engine printed (no parser involved)
    const m = /"ev":\[([^\]]*)\],"evBits":\[([^\]]*)\]/.exec(r.raw); assert.ok(m);
    assert.equal(m[1], '15.020151348500445,15.670177585564113'); assert.equal(m[2], '"402e0a51470d8f36","402f57218439052d"');
    seen.add(m[1]);
  }
  assert.equal(seen.size, 1);
  for (const threads of [1, 4]) {
    const g = S.gain({ method: 'exact', seats: [0, 1, 2, 3, 4, 5, 6, 7], threads, timeLimitMs: 600000 }); assert.ok(g.json, g.error);
    assert.deepEqual(g.json.seats.map(s => s.gainBits), PUSH8_GAIN_BITS, threads + ' threads');
    assert.deepEqual(g.json.seats.map(s => bitsOf(s.gain)), PUSH8_GAIN_BITS);
    assert.deepEqual(g.json.seats.map(s => s.gain), PUSH8_GAINS_42, 'the 4.2 reference values');
  }
  // a sampled result also carries bits (finite values) and they match its numbers
  const s = S.ev({ path: [], hands: [0], method: 'sampled', samples: 512, seed: 3 }); assert.ok(s.json, s.error);
  assert.deepEqual(s.json.hands[0].ev.map(bitsOf), s.json.hands[0].evBits);
});
test('4.4 PowerShell 5.1 number model (arithmetic model, not a PowerShell run): Decimal to Double changes exactly the EV the 4.3 report showed changed, by one ULP', { skip }, t => {
  const py = cp.spawnSync('python3', ['-I', path.join(__dirname, '..', 'tools', 'ps_number_model.py')], { encoding: 'utf8' });
  if (py.error) return t.skip('python3 unavailable');
  assert.equal(py.status, 0, py.stderr); const m = JSON.parse(py.stdout);
  for (const r of m.rows) assert.equal(r.correctlyRoundedBits, r.engineBits);
  const changed = m.rows.filter(r => r.ulpDistance !== 0);
  assert.deepEqual(changed.map(r => r.text), ['15.670177585564113']);
  assert.equal(changed[0].ulpDistance, 1); assert.equal(changed[0].modelledPowerShell51Bits, '402f57218439052c'); assert.equal(changed[0].modelledDigits, '15.670177585564112');
  // on the probe table: every modelled change is a Decimal-typed value; exponent-form values are untouched
  const dir = tmp(t), f = path.join(dir, 'p.json'); fs.writeFileSync(f, cp.spawnSync(tool(), ['--ieee'], { encoding: 'utf8' }).stdout);
  const p2 = JSON.parse(cp.spawnSync('python3', ['-I', path.join(__dirname, '..', 'tools', 'ps_number_model.py'), f], { encoding: 'utf8' }).stdout);
  for (const r of p2.rows) { assert.equal(r.correctlyRoundedBits, r.engineBits, r.text); if (r.ulpDistance) assert.equal(r.modelledType, 'Decimal', r.text); }
  assert.ok(p2.changedByModelledCast >= 1);
});
test('4.4 Windows self-test script compares bit patterns: no re-formatted number comparison remains, references are IEEE 754 patterns, failures do not stop later checks', () => {
  const ps = fs.readFileSync(path.join(__dirname, '..', 'tools', 'test_windows.ps1'), 'utf8');
  assert.ok(!ps.includes('{0:R}'), "no '{0:R}' string comparison");
  assert.ok(!ps.includes("'15.020151348500445,15.670177585564113') '4.3"), 'the 4.3 decimal-string reference is gone');
  assert.ok(ps.includes("'402e0a51470d8f36,402f57218439052d'")); assert.ok(ps.includes(PUSH8_GAIN_BITS.join(',')));
  assert.ok(/function Assert-Check[\s\S]{0,200}\$failures\.Add/.test(ps), 'a failed check is recorded and the run continues');
  assert.ok(ps.includes('--ieee-verify') && ps.includes('api/mw/ieee-probe') && ps.includes('v44=$v44'));
  // every exact comparison goes through EvBits / GainBits
  assert.ok((ps.match(/EvBits \$/g) || []).length >= 6 && (ps.match(/GainBits \$/g) || []).length >= 2);
  const hw = fs.readFileSync(path.join(__dirname, '..', 'tools', 'validate_hardware.ps1'), 'utf8');
  assert.ok(!hw.includes('{0:R}'), "validate_hardware.ps1: no '{0:R}' comparison");
});
test('4.4 desktop API serves the IEEE 754 probe document character for character as the CLI prints it (native host)', { skip }, async t => {
  const cli = cp.spawnSync(tool(), ['--ieee'], { encoding: 'utf8' }).stdout.trim();
  await withHost(home(t), {}, async api => {
    const r = await api('mw/ieee-probe'); assert.equal(r.status, 200);
    const text = (await r.text()).trim(); assert.equal(text, cli);
    for (const p of JSON.parse(text).probes) assert.equal(bitsOf(p.value), p.bits);
  });
});

// ============================== Priority 2: sampled-EV deadline ==============================
test('4.4 reproduced 4.3 regression: eight-handed range-sampled EV returns a labelled partial estimate within 50 ms of 100, 250, 600 and 1000 ms limits at 1, 2, 4 and 8 threads', { skip, timeout: 600000 }, t => {
  const F = study(t, 'icmFinal', 20, 2); const rows = [];
  for (const ms of [100, 250, 600, 1000]) for (const threads of [1, 2, 4, 8]) {
    const r = F.ev({ ...AUDIT, timeLimitMs: ms, threads }); assert.ok(r.json, r.error);
    const j = r.json, ph = j.deadline.phasesMs, over = r.timing.queryMs - ms;
    rows.push({ ms, threads, over, afterStop: ph.responseBuilt - ph.stopRaised });
    assert.equal(j.status, 'partial'); assert.equal(j.stoppedEarly, true); assert.equal(j.stoppedBy, 'timeLimit');
    assert.ok(over < TOLERANCE_IDLE_MS, 'limit ' + ms + ' ms, ' + threads + ' threads: returned ' + over.toFixed(1) + ' ms after the limit');
    assert.ok(over > -1, 'not before the limit');
    // where the time went: the stop is published at the deadline; statistics, coverage and the response follow
    assert.ok(ph.stopRaised >= ms - 0.5 && ph.stopRaised < ms + 25, 'stop published ' + (ph.stopRaised - ms).toFixed(2) + ' ms after the deadline');
    assert.ok(ph.responseBuilt - ph.stopRaised < 40, 'stop to response ' + (ph.responseBuilt - ph.stopRaised).toFixed(1) + ' ms');
    assert.ok(ph.coverageMerged - ph.statistics < 5, 'no coverage merge after the stop (' + (ph.coverageMerged - ph.statistics).toFixed(2) + ' ms)');
    assert.match(j.coverage.structure, /request-wide concurrent set/);
    // the audit's request evaluates hand 3 first; the limit is reached there, so the range aggregate is reported as not evaluated
    assert.ok(j.hands[0].samples >= j.minSamples); assert.ok(j.hands[0].ev.every(Number.isFinite)); assert.equal(j.hands[0].status, 'partial');
    assert.equal(j.range.available, false); assert.match(j.range.reason, /time limit/);
  }
  // longer limit, and a run that reaches the coverage key limit (coverageMiB 1 = 32,768 keys): the approximate-count
  // sketches are back-filled when the limit is reached, not after the stop, and worker caches are released in one call
  for (const q of [{ timeLimitMs: 3000, threads: 4 }, { timeLimitMs: 600, threads: 4, coverageMiB: 1 }, { timeLimitMs: 600, threads: 8, coverageMiB: 1 }]) {
    const r = F.ev({ ...AUDIT, ...q }); assert.ok(r.json, r.error); const ph = r.json.deadline.phasesMs, over = r.timing.queryMs - q.timeLimitMs;
    assert.equal(r.json.status, 'partial'); assert.ok(over < TOLERANCE_IDLE_MS, JSON.stringify(q) + ': returned ' + over.toFixed(1) + ' ms after the limit');
    assert.ok(ph.coverageMerged - ph.statistics < 5, JSON.stringify(q) + ': coverage finalisation after the stop took ' + (ph.coverageMerged - ph.statistics).toFixed(2) + ' ms');
    if (q.coverageMiB) { const c = r.json.coverage; assert.equal(c.distinctCountKind, 'lowerBound'); assert.equal(c.distinctInformationSets, 32768); assert.ok(c.distinctEstimates.distinctInformationSets > 32768, 'the estimate covers keys beyond the limit'); }
  }
  // the time after the stop does not grow with the limit (4.3: 8 ms at 100 ms/1 thread, 98 ms at 600 ms/4 threads)
  const med = f => { const s = rows.filter(f).map(r => r.afterStop).sort((a, b) => a - b); return s[s.length >> 1]; };
  assert.ok(med(r => r.ms === 1000) < med(r => r.ms === 100) + 15, 'after-stop time at 1000 ms (' + med(r => r.ms === 1000).toFixed(1) + ') vs 100 ms (' + med(r => r.ms === 100).toFixed(1) + ')');
});
test('4.4 partial sampled results: completed samples only, equal weights, counts and limitation reported; estimate consistent with a longer run', { skip, timeout: 600000 }, t => {
  const F = study(t, 'icmFinal', 20, 2);
  const RANGE = { path: [], hands: [], range: true, method: 'sampled', samples: 2000000 };
  const p = F.ev({ ...RANGE, timeLimitMs: 400, threads: 4, seed: 11 }).json, long = F.ev({ ...RANGE, samples: 16000, timeLimitMs: 600000, threads: 4, seed: 12 }).json;
  assert.equal(p.status, 'partial'); assert.equal(long.status, 'completed'); assert.equal(long.partialResult, undefined, 'a completed run has no partialResult block');
  const pr = p.partialResult; assert.ok(pr);
  assert.equal(pr.samplesCompleted, p.range.samples); assert.equal(p.coverage.samplesEvaluated, p.range.samples);
  assert.ok(pr.samplesDiscardedInProgress >= 0 && pr.samplesDiscardedInProgress <= 4, 'at most one sample in progress per worker: ' + pr.samplesDiscardedInProgress);
  assert.match(pr.weights, /equal/); assert.match(pr.limitation, /in progress/);
  assert.ok(p.range.samples < p.samplesRequested); assert.equal(p.cache.hit, false);
  // not cached: asking again runs again (a partial result is never served as a completed one)
  assert.equal(F.ev({ ...RANGE, timeLimitMs: 400, threads: 4, seed: 11 }).json.cache.hit, false);
  // statistically consistent with the long run (independent seeds): each action within 6 combined standard errors
  for (let a = 0; a < p.range.ev.length; a++) {
    const se = Math.hypot(p.range.stdErr[a], long.range.stdErr[a]);
    assert.ok(Math.abs(p.range.ev[a] - long.range.ev[a]) <= 6 * se + 1e-9, 'action ' + a + ': ' + p.range.ev[a] + ' vs ' + long.range.ev[a] + ' (se ' + se + ')');
    assert.ok(p.range.stdErr[a] >= long.range.stdErr[a] * 0.5, 'fewer samples do not report a much smaller standard error');
  }
  // the work counters agree with the estimate
  assert.equal(p.work.samples >= p.range.samples, true);
});
test('4.4 sampled-EV deadline under CPU load (all cores busy): partial result within the loaded tolerance', { skip, timeout: 600000 }, t => {
  const F = study(t, 'icmFinal', 20, 2);
  const burners = []; for (let i = 0; i < os.cpus().length; i++) burners.push(cp.spawn(process.execPath, ['-e', 'const e=Date.now()+60000;while(Date.now()<e){}'], { stdio: 'ignore' }));
  try {
    const over = [];
    for (const ms of [100, 250, 600]) for (const threads of [1, 4]) for (let i = 0; i < 2; i++) {
      const r = F.ev({ ...AUDIT, timeLimitMs: ms, threads }); assert.ok(r.json, r.error); assert.equal(r.json.status, 'partial');
      over.push(r.timing.queryMs - ms);
      assert.ok(r.timing.queryMs - ms < TOLERANCE_LOADED_MS, 'limit ' + ms + ', ' + threads + ' threads under load: +' + (r.timing.queryMs - ms).toFixed(1) + ' ms');
    }
    t.diagnostic('overruns under load (ms): ' + over.map(x => x.toFixed(1)).join(' '));
  } finally { for (const b of burners) b.kill(); }
});
test('4.4 cancellation latency of sampled evaluations and response gains stays below 50 ms; fault injection stops a sampled run inside sampling and retries', { skip, timeout: 600000 }, t => {
  const F = study(t, 'icmFinal', 20, 2);
  for (const [mode, q] of [['--ev', { ...AUDIT, timeLimitMs: 600000, threads: 4 }], ['--gain', { method: 'sampled', samples: 2000000, timeLimitMs: 600000 }]]) {
    const r = F.run(mode, q, { EM_CANCEL_AFTER_MS: '200' });
    assert.equal(r.timing.status, 409, mode); assert.match(r.error, /cancelled/);
    assert.ok(r.timing.cancelLatencyMs < 50, mode + ' cancellation latency ' + r.timing.cancelLatencyMs + ' ms');
    assert.equal(r.json, null, 'a cancelled evaluation reports nothing');
  }
  for (const site of ['sample', 'retry']) {
    const r = F.run('--ev', { ...AUDIT, samples: 4000, timeLimitMs: 600000, threads: 2 }, { EM_EV_FAULT: site + ':3' });
    assert.equal(r.timing.status, 409, site); assert.equal(r.json, null);
  }
});
test('4.4 coverage: the concurrent set equals the 4.3 merged tables and is identical for every thread count (complete sampled and exact runs); after a timeout it is exact and consistent', { skip, timeout: 600000 }, t => {
  const F = study(t, 'icmFinal', 20, 2), S = fixture(t);
  const pick = c => [c.policyLookups, c.storedLookups, c.fallbackLookups, c.distinctInformationSets, c.distinctStoredInformationSets, c.distinctFallbackInformationSets, c.distinctCountKind].join('|');
  // sampled, complete: deterministic work, so every count is comparable
  const q = { path: [], hands: [3], range: true, method: 'sampled', samples: 6000, seed: 5, timeLimitMs: 600000 };
  const rows = [];
  for (const threads of [1, 2, 4, 8]) for (const env of [{}, { EM_EV_MERGED_COVERAGE: '1' }]) {
    const r = F.ev({ ...q, threads }, { EM_COVERAGE_AUDIT: '1', ...env }).json; assert.equal(r.status, 'completed');
    rows.push(pick(r.coverage) + '|' + JSON.stringify(r.range.ev));
    assert.equal(r.coverage.distinctInformationSets, r.coverage.audit.distinctInformationSets, 'independent audit (std::set of every lookup)');
    assert.equal(r.coverage.distinctStoredInformationSets, r.coverage.audit.distinctStoredInformationSets); assert.equal(r.coverage.distinctFallbackInformationSets, r.coverage.audit.distinctFallbackInformationSets);
    assert.equal(r.coverage.policyLookups, r.coverage.storedLookups + r.coverage.fallbackLookups);
    assert.match(r.coverage.structure, env.EM_EV_MERGED_COVERAGE ? /merged after the workers stop/ : /request-wide concurrent set/);
  }
  assert.equal(new Set(rows).size, 1, 'identical counts and EVs for 1-8 threads, shared set and 4.3 merge:\n' + [...new Set(rows)].join('\n'));
  // exact: the 4.2/4.3 reference counts of the fixture (371 distinct, 159 stored, 212 fallback; physical report)
  for (const threads of [1, 4, 8]) {
    const c = S.ev({ ...EXACT, device: 'cpu', threads }, { EM_COVERAGE_AUDIT: '1' }).json.coverage;
    assert.deepEqual([c.distinctInformationSets, c.distinctStoredInformationSets, c.distinctFallbackInformationSets, c.policyLookups], [371, 159, 212, 387]);
    assert.equal(c.distinctInformationSets, c.audit.distinctInformationSets); assert.equal(c.distinctCountKind, 'exact');
  }
  // after a timeout: exact kind (well below the key limit), internally consistent, bounded by a longer run
  const part = F.ev({ ...AUDIT, timeLimitMs: 200, threads: 4, seed: 5 }, { EM_COVERAGE_AUDIT: '1' }).json; assert.equal(part.status, 'partial');
  const c = part.coverage; assert.equal(c.distinctCountKind, 'exact'); assert.equal(c.policyLookups, c.storedLookups + c.fallbackLookups);
  assert.equal(c.distinctInformationSets, c.audit.distinctInformationSets, 'after a timeout the set still equals the audit of every lookup made');
  assert.ok(c.distinctStoredInformationSets + c.distinctFallbackInformationSets >= c.distinctInformationSets);
  // key limit: capped counts are labelled lower bounds with estimates, never "exact"
  const capped = F.ev({ ...q, samples: 30000, threads: 4, coverageMiB: 1 }).json.coverage;
  assert.equal(capped.capacity.exactKeyLimit, 32768);
  if (capped.distinctCountKind === 'lowerBound') { assert.equal(capped.distinctInformationSets, 32768); assert.ok(capped.distinctEstimates.distinctInformationSets >= 32768); assert.equal(capped.distinctCountCapped, true); }
  else assert.ok(capped.distinctInformationSets <= 32768);
});
test('4.4 coverage units: concurrent set vs std::map reference - 1-16 threads, collisions, repeated observations, key limit, stop mid-run, 4.3 merge agreement (compiler)', { skip: !linux && 'Linux', timeout: 600000 }, t => {
  const b = compile(t, 'coverage44', ['-std=c++20', '-O2', '-I' + native, path.join(__dirname, 'coverage44.cpp'), '-lpthread']); if (b.skip) return t.skip(b.skip);
  const r = runJson(b.exe, ['200000']); assert.equal(r.status, 0, r.out.slice(0, 2000) + r.err); assert.equal(r.json.failures, 0); assert.ok(r.json.checks.length >= 40);
  // the 4.2 / 4.3 coverage units still pass against the same header
  for (const [name, args] of [['coverage42', []], ['coverage43', ['300000']]]) {
    const c = compile(t, name, ['-std=c++20', '-O2', '-I' + native, path.join(__dirname, name + '.cpp'), '-lpthread']); const x = runJson(c.exe, args); assert.equal(x.status, 0, name + ': ' + x.out.slice(0, 1000));
  }
});
test('4.4 sanitizers: coverage44 under ThreadSanitizer and ASan+UBSan with no reports (compiler)', { skip: !linux && 'Linux', timeout: 900000 }, t => {
  for (const [name, flags] of [['tsan', ['-fsanitize=thread']], ['asan', ['-fsanitize=address,undefined', '-fno-sanitize-recover=undefined']]]) {
    const b = compile(t, 'cov44_' + name, ['-std=c++20', '-O1', '-g', ...flags, '-I' + native, path.join(__dirname, 'coverage44.cpp'), '-lpthread']); if (b.skip) return t.skip(b.skip);
    const r = runJson(b.exe, ['20000'], { TSAN_OPTIONS: 'halt_on_error=1', ASAN_OPTIONS: 'detect_leaks=1' });
    assert.equal(r.status, 0, name + ': ' + (r.err || r.out).slice(0, 3000)); assert.equal(r.json.failures, 0); assert.ok(!/WARNING: ThreadSanitizer|ERROR: AddressSanitizer|runtime error/.test(r.err), r.err.slice(0, 3000));
  }
});

// ============================== Priority 4: Automatic CPU/GPU arms ==============================
test('4.4 Automatic arm selection units: exploration, the RTX 4060 Ti report timings, slow device, adaptation (compiler)', { skip: !linux && 'Linux' }, t => {
  const b = compile(t, 'auto44', ['-std=c++20', '-O2', '-I' + native, path.join(__dirname, 'auto44.cpp'), '-ldl', '-lpthread']); if (b.skip) return t.skip(b.skip);
  const r = runJson(b.exe); assert.equal(r.status, 0, r.out + r.err); assert.equal(r.json.failures, 0); assert.ok(r.json.checks.length >= 12);
});
test('4.4 Automatic on a warm device measures the three arms and keeps results bit-identical whichever arm builds the table; no context errors or leaks (Linux CUDA test double: simulated driver)', { skip: fxSkip, timeout: 900000 }, t => {
  const S = fixture(t), plan = path.join(S.dir, 'plan.json');
  const req = device => ({ ...EXACT, device, threads: 2, gpuMiB: 2048 });
  fs.writeFileSync(plan, JSON.stringify({ mode: 'ev', request: req('auto'), steps: [{ label: 'warm the device', request: req('gpu') }, { label: 'auto', repeat: 40 }, { label: 'cpu', request: req('cpu') }] }));
  const s = S.session(plan, { LD_LIBRARY_PATH: fx(), EM_GPU_INIT_ESTIMATE_S: '0' }); assert.ok(s.json, s.error);
  assert.equal(s.json.mismatches, 0, 'every request of the session returned identical EVs');
  const runs = s.json.steps[1].runs.map(r => r.results[0]);
  for (const r of runs) { assert.equal(r.status, 200); assert.equal(r.identicalToFirst, true); assert.equal(r.gpuBoards + r.cpuBoards, 376992, 'every board scored exactly once'); assert.deepEqual(r.gpuErrors, []); }
  const cls = runs[runs.length - 1].auto44.classes; assert.equal(cls.length, 1); assert.equal(cls[0].threads, 2); assert.equal(cls[0].decisions, 40);
  const arm = Object.fromEntries(cls[0].arms.map(a => [a.arm, a]));
  for (const a of ['cpu', 'gpuPull', 'gpuPreferred']) { assert.ok(arm[a].measurements >= 2, a + ' measured'); assert.ok(arm[a].meanNsPerEvaluation > 0); }
  assert.equal(arm.cpu.chosen + arm.gpuPull.chosen + arm.gpuPreferred.chosen, 40);
  // Which arm ends up fastest depends on measured wall time (the simulated device has no meaningful speed, and timings
  // move under load), so it is not asserted here; the selection logic is tested deterministically in tests/auto44.cpp.
  assert.ok(['cpu', 'gpuPull', 'gpuPreferred'].includes(cls[0].fastest));
  const observed = runs.map(r => r.observedDevice);
  assert.equal(observed.filter(o => o === 'gpu').length, arm.gpuPreferred.chosen, 'gpuPreferred tables are scored entirely by the device');
  assert.ok(observed.filter(o => o === 'cpu').length >= arm.cpu.chosen, 'cpu-arm tables use no device');
  assert.equal(runs.reduce((n, r) => n + r.auto44.thisRequest.cpu + r.auto44.thisRequest.gpuPull + r.auto44.thisRequest.gpuPreferred, 0), 40, 'one arm decision per request');
  assert.equal(s.driver.invalidContextCalls, 0); assert.equal(s.driver.liveBytesAtExit, 0); assert.equal(s.driver.pushes, s.driver.pops); assert.equal(s.driver.contextsAliveAtExit, 0);
  // EM_GPU_AUTO_MODEL=4.3 keeps the 4.3 rule: no arm decisions
  const old = S.session(plan, { LD_LIBRARY_PATH: fx(), EM_GPU_INIT_ESTIMATE_S: '0', EM_GPU_AUTO_MODEL: '4.3' }); assert.ok(old.json, old.error); assert.equal(old.json.mismatches, 0);
  const oc = old.json.steps[1].runs.map(r => r.results[0]); assert.equal(oc.reduce((n, r) => n + r.auto44.thisRequest.cpu + r.auto44.thisRequest.gpuPull + r.auto44.thisRequest.gpuPreferred, 0), 0);
});
test('4.4 Automatic never opens CUDA for a single short request and stays on the CPU with no device; device faults in Automatic fall back with identical EVs (Linux CUDA test double)', { skip: fxSkip, timeout: 900000 }, t => {
  const S = fixture(t);
  const cold = S.ev({ ...EXACT, device: 'auto', threads: 4 }, { LD_LIBRARY_PATH: fx() }); assert.ok(cold.json, cold.error);
  assert.equal(cold.json.execution.observedDevice, 'cpu'); assert.equal(cold.json.execution.cuda.attempted, false, 'one short request never pays CUDA start-up');
  assert.deepEqual(cold.json.hands[0].evBits, PUSH8_EV_BITS);
  const plan = path.join(S.dir, 'plan.json'), req = device => ({ ...EXACT, device, threads: 2, gpuMiB: 2048 });
  fs.writeFileSync(plan, JSON.stringify({ mode: 'ev', request: req('auto'), steps: [{ label: 'warm', request: req('gpu') }, { label: 'auto', repeat: 8 }] }));
  for (const fault of ['allocAfter=6', 'launch', 'download', 'missing']) {
    const s = S.session(plan, { LD_LIBRARY_PATH: fx(), EM_GPU_INIT_ESTIMATE_S: '0', EM_FIXTURE_FAULT: fault }); assert.ok(s.json, fault + ': ' + s.error);
    assert.equal(s.json.mismatches, 0, fault);
    for (const r of s.json.steps[1].runs.map(x => x.results[0])) { assert.equal(r.status, 200, fault); assert.equal(r.gpuBoards + r.cpuBoards, 376992, fault + ': nothing counted twice, nothing omitted'); }
    if (s.driver) { assert.equal(s.driver.invalidContextCalls, 0, fault); assert.equal(s.driver.liveBytesAtExit, 0, fault); }
  }
});
