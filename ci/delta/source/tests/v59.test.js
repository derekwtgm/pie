'use strict';
// EightMax 5.9 regression tests.
//   5.9 corrects the confidence reporting of the trained-response measure (native/response_stats59.hpp: a one-sided
//   distribution-free bound per seat, a simultaneous statement over the seats, a pooled statement over independent
//   seats; the 5.8 sum of normal-approximation bounds is kept under an explicit name and deprecated), draws the
//   evaluation deals from counter-based streams with a provable partition (native/response59.hpp: Philox4x64-10; the
//   5.8 streams remain selectable and reproduce 5.8 bit for bit), makes the evaluation walk faster without changing a
//   bit, and removes the folder a refused study used to leave in the desktop host. Nothing that trains a strategy
//   changed: the 5.8 tests of training identity still run against this build (tests/v58.test.js).
//   These tests cover
//     - mwcli --selftest59: every check, its exit status, sections, and that nothing passes without fixtures;
//     - the statistics against an independent Python implementation, including the generator and its addresses;
//     - mwcli --response: the 5.9 result (fields, levels, units, the deprecated field), request validation,
//       independence of threads, parallel seats and of the evaluation walk, the evaluation seed, the 5.8 streams,
//       an evaluation that cannot complete, ICM, hand groups and frozen batches;
//     - coverage against exact values on reference games (a small prespecified sample; the large experiment is
//       validation/5.9/statistics);
//     - the desktop host: a refused study leaves nothing behind (tools/host_refusal59.js);
//     - the reference responses recorded for the Windows validation (validation/5.9/windows/response);
//     - the Windows validation script of 5.9, its launchers and the workflow, statically and with a PowerShell parser
//       when one is installed.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const build = require('./native_build');
const games = require('../tools/games58.js');
const src = path.resolve(__dirname, '..'), root = path.resolve(src, '..'), studies = path.join(src, 'studies');
const cli = () => process.env.EM_TEST_MWCLI || build.cli().cli;
const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'em59-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const run = (args, env = {}) => cp.spawnSync(cli(), args.map(String), { encoding: 'utf8', timeout: 1800000, maxBuffer: 256 << 20, env: { ...process.env, ...env } });
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const specFile = (dir, key, seed = 1, extra = {}) => { const f = path.join(dir, key + '.spec.json'); fs.writeFileSync(f, JSON.stringify(games.spec(key, seed, extra))); return f; };
const trained = (dir, key, updates, seed = 1, extra = {}) => { const spec = specFile(dir, key, seed, extra), state = path.join(dir, key + '.state'); const r = run([spec, updates, 1, state, 256]); assert.equal(r.status, 0, r.stderr); return { spec, state }; };
const respond = (dir, g, request, env = {}) => { const q = path.join(dir, 'request.json'); fs.writeFileSync(q, JSON.stringify(request)); const r = run(['--response', g.spec, g.state, q, 256], env); return { r, doc: r.status === 0 ? JSON.parse(r.stdout) : null }; };
const sampledBits = d => d.seats.map(s => [s.seat, s.sampled.gain.gainBits, s.sampled.statistics.sampleVarianceBits, s.sampled.visits]);
const python = () => ['python3', 'python'].find(p => cp.spawnSync(p, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)']).status === 0);
const FIX = ['known-akq-river', 'flop3-kings-small', 'flop6-jack-small', 'icm8-bb-call-small'];
const IDS = ['engine E1', 'engine E2', 'engine E3', 'statistics S1', 'statistics S2', 'statistics S3', 'statistics S4', 'statistics S5', 'statistics S6',
  ...FIX.flatMap(f => ['R1', 'R2', 'R3', 'R6'].map(k => 'response ' + f + ' ' + k)), 'response known-akq-river R4', 'response flop3-kings-small R4', 'response known-akq-river R5', 'response flop6-jack-small R5',
  'response incomplete', 'response family', 'response requests'];

// ---------------- mwcli --selftest59 ----------------
test('5.9 self-test: every check passes, the report lists each of them once, and the exit status says the same', t => {
  const d = tmp(t), r = run(['--selftest59', studies, d, 'all']);
  assert.equal(r.status, 0, r.stderr.slice(-3000));
  const doc = JSON.parse(fs.readFileSync(path.join(d, 'selftest59.json'), 'utf8')), line = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(doc.tool, 'mwcli selftest59'); assert.equal(doc.section, 'all');
  assert.deepEqual(doc.checks.map(c => c.section + ' ' + c.id).sort(), [...IDS].sort());
  for (const c of doc.checks) { assert.equal(c.status, 'passed', c.id + ': ' + c.detail); assert.ok(c.name.length > 20 && typeof c.detail === 'string'); }
  assert.deepEqual([doc.passed, doc.failed, doc.untested], [IDS.length, 0, 0]); assert.deepEqual([line.passed, line.failed, line.untested], [IDS.length, 0, 0]);
  const of = id => doc.checks.find(c => c.section + ' ' + c.id === id);
  assert.match(of('engine E1').detail, /^0 of 12 output words differ; computed: 16554d9eca36314c db20fe9d672d0fdc d7e772cee186176b 7e68b68aec7ba23b;/);
  assert.match(of('engine E2').detail, /20000 random \(counter, key\) pairs, 0 not recovered/);
  assert.match(of('statistics S2').detail, /^117 cases, 0 above their level/);
  assert.match(of('statistics S3').detail, /small value with probability 1e-6: 0\.815/, 'the normal bound exceeds the truth with probability exp(-0.2048)');
  for (const f of FIX) { assert.match(of('response ' + f + ' R1').detail, /seat bounds above exact: 0$/); assert.match(of('response ' + f + ' R6').detail, /8 runs against the 5\.8 walk .* 0 differences/); }
});
test('5.9 self-test: sections can be run alone; a wrong section or a missing folder is a usage error; nothing passes without fixtures', t => {
  const d = tmp(t), read = () => JSON.parse(fs.readFileSync(path.join(d, 'selftest59.json'), 'utf8'));
  let r = run(['--selftest59', studies, d, 'engine']); assert.equal(r.status, 0, r.stderr); assert.equal(read().checks.length, 3);
  r = run(['--selftest59', studies, d, 'statistics']); assert.equal(r.status, 0, r.stderr); assert.equal(read().checks.length, 6);
  r = run(['--selftest59', studies, d, 'everything']); assert.equal(r.status, 2); assert.match(r.stderr, /section must be/);
  r = run(['--selftest59', path.join(d, 'nowhere'), d]); assert.equal(r.status, 2);
  r = run(['--selftest59']); assert.equal(r.status, 2); assert.match(r.stderr, /usage/);
  const empty = path.join(d, 'studies'), work = path.join(d, 'work'); fs.mkdirSync(empty); fs.mkdirSync(work);
  r = run(['--selftest59', empty, work, 'response']); assert.equal(r.status, 1);
  const doc = JSON.parse(fs.readFileSync(path.join(work, 'selftest59.json'), 'utf8')); assert.equal(doc.passed, 0); assert.ok(doc.untested >= 4); for (const c of doc.checks) assert.equal(c.status, 'untested', c.id);
});

// ---------------- an independent implementation ----------------
test('5.9 statistics and streams: an independent Python implementation agrees (Philox4x64-10, stream addresses, exact two-point coverage, every bound of a result)', t => {
  const py = python(); if (!py) return t.skip('no Python 3 interpreter on this machine');
  const tool = path.join(src, 'tools/independent_stats59.py');
  let r = cp.spawnSync(py, [tool, 'selfcheck', cli()], { encoding: 'utf8', timeout: 600000 }); assert.equal(r.status, 0, r.stdout + r.stderr);
  const checks = JSON.parse(r.stdout).checks; assert.ok(checks.length >= 4); for (const c of checks) assert.notEqual(c.passed, false, c.name + ': ' + c.detail);
  assert.ok(checks.some(c => /mwcli --streams59/.test(c.name) && c.passed === true), 'the engine\'s streams were compared');
  const d = tmp(t), files = [];
  for (const [key, updates, request] of [['river3-chip', 20000, { responseDeals: 100000, samples: 20480, seed: 59, exact: true }], ['flop6', 20000, { responseDeals: 50000, samples: 51200, seed: 7, confidence: 0.99, analyses: 3, futureActions: 'sample' }], ['bubble4', 5000, { responseDeals: 20000, samples: 20480, seed: 59, seats: [0, 2], randomStreams: '5.8' }]]) {
    const g = trained(d, key, updates), { r: rr, doc } = respond(d, g, request); assert.equal(rr.status, 0, rr.stderr); const f = path.join(d, key + '.result.json'); fs.writeFileSync(f, JSON.stringify(doc)); files.push(f);
  }
  r = cp.spawnSync(py, [tool, 'check', ...files], { encoding: 'utf8', timeout: 600000 }); assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const line of r.stdout.trim().split('\n')) assert.match(line, /: agrees$/);
});
test('5.9 streams: mwcli --streams59 prints the known-answer block for the zero address of the key it would use, and refuses addresses outside its ranges', t => {
  let r = run(['--streams59', 0, 0, 0, 0, 8]); assert.equal(r.status, 0, r.stderr); const a = JSON.parse(r.stdout);
  assert.equal(a.method, 'philox4x64-10-counter-v1'); assert.equal(a.bits.length, 8); assert.equal(a.unit.length, 8);
  for (let i = 0; i < 8; i++) { assert.match(a.bits[i], /^[0-9a-f]{16}$/); assert.equal(a.unit[i], Number(BigInt('0x' + a.bits[i]) >> 11n) / 9007199254740992); assert.ok(a.unit[i] >= 0 && a.unit[i] < 1); }
  const b = JSON.parse(run(['--streams59', 0, 0, 0, 0, 4]).stdout); assert.deepEqual(b.bits, a.bits.slice(0, 4), 'a stream is a function of its address');
  const seen = new Set(); for (const [seed, seat, block, purpose] of [[0, 0, 0, 0], [0, 0, 0, 1], [0, 0, 1, 0], [0, 1, 0, 0], [1, 0, 0, 0]]) seen.add(JSON.parse(run(['--streams59', seed, seat, block, purpose, 4]).stdout).bits.join());
  assert.equal(seen.size, 5, 'every coordinate of the address changes the stream');
  for (const bad of [[0, 8, 0, 0, 4], [0, 0, 0, 2, 4], [0, 0, 0, 0, 0], [0, 0, 0, 0, 5000], [-1, 0, 0, 0, 4], [0, 0, 0, 0]]) { r = run(['--streams59', ...bad]); assert.equal(r.status, 2, bad.join(' ')); assert.match(r.stderr, /usage/); }
});

// ---------------- mwcli --response: the 5.9 result ----------------
test('5.9 response: the summary separates estimates, normal-approximation bounds and confidence statements, and names levels, family, units and assumptions', t => {
  const d = tmp(t), g = trained(d, 'river3-chip', 20000), { r, doc } = respond(d, g, { responseDeals: 200000, samples: 51200, seed: 59, exact: true });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(doc.tool, 'mwcli response 5.9'); assert.equal(doc.schema, 'response-5.9'); assert.equal(doc.randomStreams, '5.9'); assert.equal(doc.confidence, 0.95); assert.equal(doc.analyses, 1); assert.equal(doc.evaluationSeed, 59);
  assert.ok(Math.abs(doc.perSeatAlpha - 0.05 / 3) < 1e-15); assert.ok(doc.evaluationThreads >= 1);
  const S = doc.summary, sim = S.simultaneous, po = S.pooledIndependent;
  assert.equal(S.unit, 'BB (chip EV)'); assert.equal(S.seatsRequested, 3); assert.equal(S.seatsEvaluated, 3); assert.equal(S.allSeats, true);
  // the 5.8 fields are all there and mean what they meant
  assert.ok(S.sumOfSeatGains.stdErr > 0); assert.match(S.sumOfSeatGains.kind, /normal approximations \(not calibrated/);
  const legacy = doc.seats.reduce((a, s) => a + Math.max(0, s.sampled.gain.mean - 1.6448536269514722 * s.sampled.gain.stdErr), 0);
  assert.ok(Math.abs(S.sumOfSeatLowerBounds95 - legacy) < 1e-12); assert.equal(S.sumOfNormalApproximationLowerBounds95, S.sumOfSeatLowerBounds95);
  assert.equal(S.deprecated.sumOfSeatLowerBounds95.since, '5.9'); assert.equal(S.deprecated.sumOfSeatLowerBounds95.useInstead, 'simultaneous.nashConvLowerBound'); assert.match(S.deprecated.sumOfSeatLowerBounds95.why, /not a 95% statement about the sum/);
  // the simultaneous statement
  assert.equal(sim.calculation, 'response-5.9-simultaneous-union-v1'); assert.equal(sim.recommended, true); assert.equal(sim.calibrated, true); assert.equal(sim.reason, ''); assert.equal(sim.confidence, 0.95); assert.equal(sim.alpha, 0.05);
  assert.deepEqual(sim.family.seats, [0, 1, 2]); assert.equal(sim.family.size, 3); assert.match(sim.allocation, /^equal: alpha \/ analyses \/ seats$/); assert.match(sim.dependenceBetweenSeats, /^none assumed/);
  assert.match(sim.perSeatMethod, /empirical Bernstein, one-sided \(Maurer-Pontil 2009, Theorem 4\)/); assert.equal(sim.assumptions.length, 6); assert.match(sim.relationToNashConv, /NashConv >= .* >= nashConvLowerBound .* LOWER bound .* not an upper bound, not exploitability/);
  let sum = 0, floored = 0;
  for (const [i, row] of sim.seats.entries()) {
    const b = doc.seats[i].sampled, lb = b.lowerBound, st = b.statistics; assert.equal(row.seat, doc.seats[i].seat); assert.equal(row.evaluated, true); assert.equal(row.alpha, doc.perSeatAlpha);
    assert.equal(b.calculation, 'response-5.9-paired-v2'); assert.equal(b.randomStreams.method, 'philox4x64-10-counter-v1'); assert.match(b.randomStreams.partition, /^proven for one seed: Philox4x64-10 is a bijection/); assert.equal(b.walk.version, '5.9'); assert.equal(b.walk.valuesDependOnIt, false);
    assert.equal(lb.calculation, 'response-5.9-eb-one-sided-v1'); assert.equal(lb.alpha, doc.perSeatAlpha); assert.equal(lb.calibrated, true); assert.equal(lb.responseGain, row.responseGainLowerBound); assert.equal(lb.bestResponseGain, Math.max(0, lb.responseGain));
    assert.equal(st.samples, 51200); assert.equal(st.mean, b.gain.mean); assert.ok(Math.abs(Math.sqrt(st.sampleVariance / st.samples) - b.gain.stdErr) < 1e-15); assert.equal(st.provenSampleRange, b.bounded.sampleRange); assert.equal(st.withinProvenRange, true);
    assert.equal(st.sampleCountFixedInAdvance, true); assert.equal(st.responseFixedBeforeEvaluation, true);
    // one-sided at alpha / 3 uses ln(2 * 3 / 0.05); the 5.8 two-sided interval at 0.05 uses ln(4 / 0.05): written out
    const L = Math.log(2 / lb.alpha), half = Math.sqrt(2 * st.sampleVariance * L / st.samples) + 7 * st.provenSampleRange * L / (3 * (st.samples - 1)); assert.ok(Math.abs(lb.half - half) < 1e-13 * Math.max(1, half));
    assert.ok(row.responseGainLowerBound < b.gain.mean); assert.equal(row.bestResponseGainLowerBound, Math.max(0, row.responseGainLowerBound)); sum += row.responseGainLowerBound; floored += row.bestResponseGainLowerBound;
    assert.ok(b.bounded.half > 0 && typeof b.bestResponseGainLowerBound.normal95 === 'number', 'the 5.8 per-seat fields are still written');
  }
  assert.ok(Math.abs(sim.sumOfResponseGainsLowerBound - sum) < 1e-12); assert.ok(Math.abs(sim.nashConvLowerBound - floored) < 1e-12); assert.equal(sim.complete, true); assert.equal(sim.nashConvLowerBoundUsesEverySeat, true);
  assert.match(sim.bits.nashConvLowerBound, /^[0-9a-f]{16}$/);
  // the pooled statement
  assert.equal(po.calculation, 'response-5.9-pooled-bernstein-subsets-v1'); assert.equal(po.recommended, false); assert.equal(po.calibrated, true); assert.equal(po.family.subsets, 7); assert.match(po.dependenceBetweenSeats, /^ASSUMED INDEPENDENT/);
  assert.ok(Math.abs(po.allocation.perSubsetBernstein - 0.05 / 14) < 1e-15 && Math.abs(po.allocation.perSeatVariance - 0.05 / 6) < 1e-15); assert.ok(po.bestSubset.sumOfResponseGainsLowerBound >= po.sumOfResponseGainsLowerBound); assert.equal(po.nashConvLowerBound, Math.max(0, po.bestSubset.sumOfResponseGainsLowerBound));
  assert.match(po.withSimultaneous, /confidence 1 - 2 \* alpha; request confidence 0\.975/);
  // against the exact values of the same responses
  const exactSum = doc.seats.reduce((a, s) => a + s.exact.gain, 0), nash = doc.seats.reduce((a, s) => a + s.exact.bestResponseGain, 0);
  for (const [i, row] of sim.seats.entries()) assert.ok(row.responseGainLowerBound <= doc.seats[i].exact.gain, 'seat ' + i);
  assert.ok(sim.sumOfResponseGainsLowerBound <= exactSum && sim.nashConvLowerBound <= nash && po.sumOfResponseGainsLowerBound <= exactSum && po.nashConvLowerBound <= nash);
  assert.deepEqual(S.againstExact, { seatBoundsChecked: 3, seatBoundsHolding: 3, simultaneousHolds: true, simultaneousNashConvBoundHolds: true, pooledAllSeatsHolds: true, pooledBestSubsetHolds: true });
});
test('5.9 response: confidence and analyses set the per-seat level; ICM results carry their unit; a subset of the seats is still a lower bound of NashConv', t => {
  const d = tmp(t), g = trained(d, 'bubble4', 5000), base = { responseDeals: 50000, samples: 20480, seed: 59 };
  const a = respond(d, g, base).doc, b = respond(d, g, { ...base, confidence: 0.975, analyses: 2 }).doc, c = respond(d, g, { ...base, seats: [1, 3] }).doc;
  assert.equal(a.summary.unit, 'payout units (ICM tournament equity)'); assert.ok(Math.abs(a.perSeatAlpha - 0.05 / 4) < 1e-15); assert.ok(Math.abs(b.perSeatAlpha - 0.025 / 2 / 4) < 1e-15); assert.equal(b.summary.simultaneous.alpha, 0.025); assert.equal(b.summary.simultaneous.analyses, 2);
  assert.deepEqual(sampledBits(a), sampledBits(b), 'the level changes the bounds, not the sample');
  assert.ok(b.summary.simultaneous.sumOfResponseGainsLowerBound < a.summary.simultaneous.sumOfResponseGainsLowerBound && b.summary.pooledIndependent.sumOfResponseGainsLowerBound < a.summary.pooledIndependent.sumOfResponseGainsLowerBound);
  assert.equal(c.summary.allSeats, false); assert.deepEqual(c.summary.simultaneous.family.seats, [1, 3]); assert.ok(Math.abs(c.perSeatAlpha - 0.05 / 2) < 1e-15); assert.equal(c.summary.simultaneous.nashConvLowerBoundUsesEverySeat, false); assert.match(c.summary.reading, /still a lower bound of NashConv/);
  assert.deepEqual(sampledBits(c), sampledBits(a).filter(x => x[0] === 1 || x[0] === 3), 'a seat is evaluated on its own streams whatever the other seats do');
});
test('5.9 response: malformed 5.9 request fields are refused before anything is trained', t => {
  const d = tmp(t), g = trained(d, 'hu-river', 2000);
  const bad = [[{ confidence: 1 }, /confidence must be a number from 0\.5 to 0\.999999/], [{ confidence: 0.4 }, /confidence must be/], [{ confidence: '95%' }, /confidence must be/], [{ analyses: 0 }, /analyses must be a whole number from 1 to 1000/], [{ analyses: 2.5 }, /analyses must be a whole number/],
    [{ randomStreams: '5.7' }, /randomStreams must be "5\.9" or "5\.8"/], [{ randomStreams: 5.9 }, /randomStreams must be/], [{ evaluationSeed: -1 }, /evaluationSeed must be a whole number from 0 to 4294967295/], [{ evaluationSeed: 'x' }, /evaluationSeed must be/], [{ simultaneous: true }, /unknown request field "simultaneous"/]];
  for (const [q, re] of bad) { const { r } = respond(d, g, q); assert.equal(r.status, 2, JSON.stringify(q)); assert.match(r.stderr, re); assert.equal(r.stdout, ''); }
});

// ---------------- determinism and the streams ----------------
test('5.9 response: the same bits for any number of threads and of parallel seats and for every evaluation walk; another evaluation seed evaluates the same response on other deals', t => {
  const d = tmp(t);
  for (const [key, updates, extra] of [['mid3-turn', 10000, {}], ['bubble5-icm', 5000, {}], ['flop6w', 20000, { futureActions: 'sample' }]]) {
    const g = trained(d, key, updates), base = { responseDeals: 50000, samples: 20480, seed: 59, threads: 1, ...extra }, ref = respond(d, g, base); assert.equal(ref.r.status, 0, ref.r.stderr);
    const want = sampledBits(ref.doc), bounds = x => [x.summary.simultaneous.bits, x.summary.pooledIndependent.bits, x.summary.sumOfSeatLowerBounds95];
    for (const v of [{ threads: 3 }, { threads: 2, parallelSeats: 3 }, { threads: undefined }]) { const x = respond(d, g, JSON.parse(JSON.stringify({ ...base, ...v }))); assert.equal(x.r.status, 0, x.r.stderr); assert.deepEqual(sampledBits(x.doc), want, key + ' ' + JSON.stringify(v)); assert.deepEqual(bounds(x.doc), bounds(ref.doc)); }
    for (const env of [{ EIGHTMAX_RESPONSE_WALK: '5.8' }, { EIGHTMAX_RESPONSE_INDEX: '0' }, { EIGHTMAX_RESPONSE_INDEX: '1' }, { EIGHTMAX_RESPONSE_INDEX: '2' }]) { const x = respond(d, g, base, env); assert.equal(x.r.status, 0, x.r.stderr); assert.deepEqual(sampledBits(x.doc), want, key + ' ' + JSON.stringify(env)); assert.equal(x.doc.seats[0].sampled.walk.version, env.EIGHTMAX_RESPONSE_WALK ? '5.8' : '5.9'); }
    const other = respond(d, g, { ...base, evaluationSeed: 60, exact: true }), again = respond(d, g, { ...base, exact: true });
    assert.deepEqual(other.doc.seats.map(s => s.exact.gainBits), again.doc.seats.map(s => s.exact.gainBits), key + ': the response does not depend on the evaluation seed'); assert.ok(sampledBits(other.doc).every((x, i) => x[1] !== want[i][1]), 'other deals');
    assert.equal(other.doc.summary.againstExact.simultaneousHolds, true); assert.equal(again.doc.summary.againstExact.simultaneousHolds, true);
  }
});
test('5.9 response: the 5.8 streams are still drawn on request, are named in the result, and differ from the 5.9 streams', t => {
  const d = tmp(t), g = trained(d, 'turn4', 20000), base = { responseDeals: 50000, samples: 20480, seed: 58 };
  const a = respond(d, g, base).doc, b = respond(d, g, { ...base, randomStreams: '5.8' }).doc, b2 = respond(d, g, { ...base, randomStreams: '5.8', threads: 3 }).doc;
  assert.equal(b.randomStreams, '5.8'); for (const s of b.seats) { assert.equal(s.sampled.calculation, 'response-5.8-paired-v1'); assert.equal(s.sampled.randomStreams.method, 'splitmix64-hashed-block-seeds-5.8'); assert.match(s.sampled.randomStreams.partition, /^none proven/); }
  assert.deepEqual(sampledBits(b), sampledBits(b2)); assert.ok(sampledBits(a).every((x, i) => x[1] !== sampledBits(b)[i][1]));
  // both estimate the same gains: each lies inside the other's distribution-free interval
  for (const [i, s] of a.seats.entries()) assert.ok(Math.abs(s.sampled.gain.mean - b.seats[i].sampled.gain.mean) <= s.sampled.bounded.half + b.seats[i].sampled.bounded.half);
});
test('5.9 response: an evaluation that cannot complete is reported as unavailable, and the summary neither shortens the sample nor claims a sum', t => {
  const d = tmp(t), g = trained(d, 'hu-river', 2000), { r, doc } = respond(d, g, { responseDeals: 1000, samples: 1000000000, seed: 59, timeLimitMs: 100 });
  assert.equal(r.status, 0, r.stderr); const S = doc.summary;
  for (const s of doc.seats) { assert.equal(s.sampled.available, false); assert.match(s.sampled.reason, /partial sample is never reported/); }
  assert.equal(S.seatsEvaluated, 0); assert.equal(S.sumOfSeatGains, undefined); assert.equal(S.sumOfSeatLowerBounds95, undefined);
  assert.equal(S.simultaneous.calibrated, true); assert.equal(S.simultaneous.complete, false); assert.equal(S.simultaneous.sumOfResponseGainsLowerBound, null); assert.equal(S.simultaneous.nashConvLowerBound, 0); assert.ok(S.simultaneous.seats.every(x => x.evaluated === false && x.bestResponseGainLowerBound === 0 && x.responseGainLowerBound === null));
  assert.equal(S.pooledIndependent.nashConvLowerBound, 0); assert.equal(S.pooledIndependent.sumOfResponseGainsLowerBound, null);
});
test('5.9 response: frozen batches with several threads, ICM, and hand groups keep every statement valid against exact values', t => {
  const d = tmp(t);
  for (const [key, updates, extra] of [['short8-push', 3000, {}], ['sidepot3-icm', 20000, {}], ['flop5', 20000, {}]]) {
    const g = trained(d, key, updates), { r, doc } = respond(d, g, { responseDeals: 40000, samples: 20480, seed: 59, exact: true, threads: 2, parallelSeats: 2, ...extra });
    assert.equal(r.status, 0, key + ': ' + r.stderr); const A = doc.summary.againstExact; assert.equal(A.seatBoundsHolding, A.seatBoundsChecked, key); assert.equal(A.simultaneousHolds, true); assert.equal(A.simultaneousNashConvBoundHolds, true); assert.equal(A.pooledBestSubsetHolds, true);
    assert.ok(doc.summary.simultaneous.nashConvLowerBound <= doc.summary.exactNashConv);
  }
});

// ---------------- coverage against exact values (a small sample; the experiment is validation/5.9/statistics) ----------------
test('5.9 coverage: 39 independent evaluations of fixed responses on three reference games never put a distribution-free bound above the exact value', t => {
  const d = tmp(t); let seatBounds = 0, seatAbove = 0, runs = 0, simAbove = 0, poolAbove = 0;
  for (const [key, updates] of [['hu-turn', 5000], ['turn4', 5000], ['final8', 5000]]) {
    const g = trained(d, key, updates), base = { responseDeals: 20000, samples: 20480, seed: 59, futureActions: 'sample', threads: 1, parallelSeats: 2 };
    const ex = respond(d, g, { ...base, exact: true }).doc, exact = ex.seats.map(s => s.exact.gain), nash = ex.summary.exactNashConv;
    for (let e = 1; e <= 13; e++) {
      const x = respond(d, g, { ...base, evaluationSeed: e }).doc; runs++;
      x.summary.simultaneous.seats.forEach((row, i) => { seatBounds++; seatAbove += row.responseGainLowerBound > exact[i]; });
      simAbove += x.summary.simultaneous.nashConvLowerBound > nash; poolAbove += x.summary.pooledIndependent.nashConvLowerBound > nash;
    }
  }
  assert.equal(runs, 39); assert.equal(seatAbove, 0, seatAbove + ' of ' + seatBounds + ' seat bounds above the exact gain'); assert.equal(simAbove, 0); assert.equal(poolAbove, 0);
});

// ---------------- the desktop host: a refused study leaves nothing behind ----------------
test('5.9 desktop host: a refused study leaves no folder; existing folders, checkpoints and running studies are never touched (tools/host_refusal59.js)', async t => {
  const exe = process.env.EM_TEST_HOST || build.host().exe;
  const out = await require('../tools/host_refusal59.js').run(exe, src);
  assert.equal(out.version, fs.readFileSync(path.join(src, 'VERSION'), 'utf8').trim()); assert.equal(out.checks.length, 9);
  for (const c of out.checks) assert.ok(c.passed, c.name + ': ' + JSON.stringify(c.detail).slice(0, 1500));
});
test('5.9 desktop host: the undo rules are in the source as documented (nothing recursive, a manifest stops everything)', t => {
  const h = fs.readFileSync(path.join(src, 'native/study_jobs.h'), 'utf8'), undo = h.slice(h.indexOf('static void study_undo_refused'), h.indexOf('typedef struct { char *fixture;'));
  assert.ok(undo.length > 500); assert.ok(!/study_discard|opendir|FindFirstFile|remove_all/.test(undo), 'the undo removes one named file and one empty folder, nothing else');
  assert.ok(undo.indexOf('manifest.json') < undo.indexOf('remove(file)') && undo.indexOf('manifest.json') > 0, 'a checkpoint is looked for before anything is removed');
  assert.equal((undo.match(/\bremove\(/g) || []).length, 1); assert.equal((undo.match(/rmdir\(/g) || []).length, 2, 'rmdir (POSIX and Windows): removes only an empty folder');
  assert.match(h, /"refusedStudyFolder"/);
});

// ---------------- reference responses for the Windows validation ----------------
test('5.9 reference responses: this build reproduces the recorded bits (validation/5.9/windows/response)', t => {
  const dir = path.join(root, 'validation/5.9/windows/response'), file = path.join(dir, 'golden59.json');
  if (!fs.existsSync(file)) return t.skip('validation/5.9/windows/response/golden59.json is not in this tree (it is recorded from the final build)');
  const g = JSON.parse(fs.readFileSync(file, 'utf8')), d = tmp(t); assert.ok(g.cases.length >= 4);
  for (const c of g.cases) {
    const spec = path.join(dir, c.spec), state = path.join(d, c.name + '.state');
    assert.equal(run([spec, c.updates, 1, state, c.memoryMiB]).status, 0); assert.equal(sha(state), c.stateSha256, c.name);
    for (const rq of [c.request, c.parallelRequest]) {
      const r = run(['--response', spec, state, path.join(dir, rq), c.memoryMiB]); assert.equal(r.status, 0, r.stderr); const doc = JSON.parse(r.stdout);
      assert.deepEqual(doc.seats.map(s => s.seat + ':' + s.sampled.gain.gainBits + ':' + s.sampled.statistics.sampleVarianceBits + ':' + s.exact.gainBits + ':' + s.exact.bestResponseGainBits), c.seatBits, c.name + ' ' + rq);
      assert.deepEqual([doc.summary.simultaneous.bits.sumOfResponseGainsLowerBound, doc.summary.simultaneous.bits.nashConvLowerBound, doc.summary.pooledIndependent.bits.sumOfResponseGainsLowerBound, doc.summary.pooledIndependent.bits.bestSubset], c.summaryBits, c.name + ' ' + rq);
      assert.equal(doc.summary.againstExact.simultaneousHolds, true); assert.equal(doc.summary.againstExact.simultaneousNashConvBoundHolds, true);
    }
  }
});

// ---------------- the Windows validation of 5.9 ----------------
test('5.9 Windows validation: the script plans and imports every 5.9 check, the launchers run the self-tests first, the workflow gates on them', t => {
  const file = path.join(src, 'tools/validate_windows59.ps1'), ps = fs.readFileSync(file, 'utf8'), version = fs.readFileSync(path.join(src, 'VERSION'), 'utf8').trim();
  assert.ok(['5.9', '5.10', '5.11'].includes(version), version); assert.match(ps, /\$Release = '5\.9'/); assert.match(ps, /tool = 'validate_windows59\.ps1'/); assert.ok(!/[^\x00-\x7f]/.test(ps), 'the script is ASCII');   // 5.10: the 5.9 script is kept as it ran on Windows; validate_windows510.ps1 is the script of this release (tests/v510.test.js)
  for (const s of ["Run-Section 'self-test 5.9'", "Run-Section 'self-test 5.8'", "Run-Section 'self-test 5.7.1'", "Run-Section 'trained response'", "Run-Section 'refused study'", "Run-Section 'golden states'", "Run-Section 'GPU'", "'--selftest59', $studies, $dir, 'all'", "validation\\5.9\\windows\\response", "validation\\5.8\\windows\\response", "'every expected 5.9 check is in the report'", 'refusedStudyFolder']) assert.ok(ps.includes(s), s);
  for (const id of ['engine E1', 'engine E3', 'statistics S1', 'statistics S6', 'response incomplete', 'response family', 'response requests']) assert.ok(ps.includes("'" + id + "'"), id);
  const plans = [...ps.matchAll(/^Plan '([^']+)' '([^']+)' '([^']+)'/gm)]; assert.ok(plans.length >= 55, plans.length + ' planned checks');
  for (const [, , , cls] of plans) assert.ok(['gate', 'environment', 'hardware', 'information'].includes(cls));
  for (const name of ['mwcli --selftest59 ran and wrote its report', 'every expected 5.9 check is in the report', 'the 5.9 report agrees with the exit status of mwcli', 'every 5.9 reference response reproduced', 'the 5.8 streams reproduce the 5.8 reference responses', 'parallel seats give the same bits', 'an over-limit study is refused and leaves no folder', 'a folder that existed before is kept with its files', 'an ordinary study completes after the refusal']) {
    assert.equal(plans.filter(p => p[2] === name).length, 1, 'planned once: ' + name); assert.ok(ps.split("Check '" + plans.find(p => p[2] === name)[1] + "' '" + name + "'").length >= 2, 'planned but never recorded: ' + name);
  }
  // focused mode covers what 5.9 added
  const focus = /\$focusSections = @\(([^)]*)\)/.exec(ps)[1]; for (const s of ["'self-test 5.9'", "'trained response'", "'refused study'", "'self-test 5.8'"]) assert.ok(focus.includes(s), 'focused: ' + s);
  const py = python(); if (py) { const r = cp.spawnSync(py, [path.join(src, 'tools/ps_lint571.py'), file], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stdout + r.stderr); }
  // a real parser, when one is installed (Windows PowerShell or PowerShell 7): no syntax error in any script of the release
  const pw = ['pwsh', 'powershell', path.join(os.homedir(), '.dotnet/tools/pwsh')].find(p => { try { return cp.spawnSync(p, ['-NoProfile', '-Command', 'exit 0'], { timeout: 60000 }).status === 0; } catch { return false; } });
  if (pw) for (const f of fs.readdirSync(path.join(src, 'tools')).filter(f => f.endsWith('.ps1'))) {
    const r = cp.spawnSync(pw, ['-NoProfile', '-Command', "$e = $null; $t = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('" + path.join(src, 'tools', f).replace(/'/g, "''") + "', [ref]$t, [ref]$e); if ($e.Count) { $e | ForEach-Object { $_.ToString() }; exit 1 }"], { encoding: 'utf8', timeout: 120000 });
    assert.equal(r.status, 0, f + ': ' + r.stdout + r.stderr);
  }
  for (const [name, needs] of [['Run 5.9 Windows validation.bat', ['mwcli.exe --selftest57 ', 'mwcli.exe --selftest571 ', 'mwcli.exe --selftest58 ', 'mwcli.exe --selftest59 ', 'validate_windows59.ps1" %*', 'Windows-selftest59-5.9.json', 'Windows-validation-5.9.json']], ['Run 5.9 focused validation.bat', ['mwcli.exe --selftest59 ', 'validate_windows59.ps1" -Focused %*', 'Windows-focused-validation-5.9.json']], ['Run 5.9 response example.bat', ['mwcli.exe --response ', 'example-request.json']]]) {
    const f = path.join(root, name); if (!fs.existsSync(f)) continue;   // the launchers live in the release root, not in a bare source tree
    const b = fs.readFileSync(f); assert.ok(!/[^\x00-\x7f]/.test(b.toString('latin1')), name + ' is ASCII'); const text = b.toString('latin1');
    assert.ok(!/[^\r]\n/.test(text), name + ' has CRLF line ends'); for (const n of needs) assert.ok(text.includes(n), name + ': ' + n); assert.match(text, /exit \/b %\w+%\r\n$/);
    if (/validation\.bat$/.test(name)) assert.match(text, /if not exist "Windows-(focused-)?validation-5\.9\.json" if "%eightmax_result%"=="0" set "eightmax_result=2"/, name + ': a missing report is not a pass');
  }
  const wf = path.join(root, '.github/workflows/windows.yml');
  if (fs.existsSync(wf)) { const y = fs.readFileSync(wf, 'utf8'); for (const s of ['--selftest59 source/studies', version === '5.9' ? 'validate_windows59.ps1 -Root' : version === '5.10' ? 'validate_windows510.ps1 -Root' : 'validate_windows511.ps1 -Root', version === '5.9' ? 'Windows-validation-5.9.json' : version === '5.10' ? 'Windows-validation-5.10.json' : 'Windows-validation-5.11.json', 'windows-selftest59.json', 'source/tests/v59.test.js']) assert.ok(y.includes(s), s); assert.ok(!/continue-on-error:\s*true/.test(y), 'no gate is allowed to fail silently'); }   // 5.10: the workflow runs the 5.10 script, which contains every 5.9 section
});
