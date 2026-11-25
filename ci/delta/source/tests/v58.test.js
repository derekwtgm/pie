'use strict';
// EightMax 5.8 regression tests.
//   5.8 adds a quality measure for games too large for an exact best response (the TRAINED RESPONSE,
//   native/response58.hpp, mwcli --response), refuses an over-limit study budget when the study is configured
//   instead of after training to the limit, makes the exact ICM cache four-way associative, and adds five
//   tournament-stage reference games (tools/games58.js). Nothing that trains a strategy changed.
//   These tests cover
//     - mwcli --selftest58: every check, its exit status, and that it reports failed or untested (never passed)
//       when its fixtures are missing;
//     - mwcli --response: request validation, the shape and wording of the result, the direction of the measure
//       against the exact best response, independence of threads and of parallel seats, the saved response state
//       under the ordinary evaluators, frozen batches, hand groups, and an independent Python cross-check;
//     - training identity: the states of eight reference games equal those of the 5.7.1 binary, byte for byte,
//       for one and three threads (the ICM cache and the one-seat switch must not change training);
//     - the large-study limit from the command line;
//     - the desktop host's checkpoint lock, released before the answer (the cause of load-sensitive test failures);
//     - the reference responses recorded for the Windows validation (validation/5.8/windows/response);
//     - the Windows validation script, its launchers and the workflow, statically.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const build = require('./native_build');
const games = require('../tools/games58.js');
const src = path.resolve(__dirname, '..'), root = path.resolve(src, '..'), studies = path.join(src, 'studies');
const cli = () => process.env.EM_TEST_MWCLI || build.cli().cli;
const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'em58-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const run = (args, env = {}) => cp.spawnSync(cli(), args.map(String), { encoding: 'utf8', timeout: 1800000, maxBuffer: 256 << 20, env: { ...process.env, ...env } });
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const AKQ = path.join(studies, 'known-akq-river.emfix.json');
const specFile = (dir, key, seed = 1, extra = {}) => { const f = path.join(dir, key + '.spec.json'); fs.writeFileSync(f, JSON.stringify(games.spec(key, seed, extra))); return f; };
const trained = (dir, key, updates, seed = 1, extra = {}) => { const spec = specFile(dir, key, seed, extra), state = path.join(dir, key + '.state'); const r = run([spec, updates, 1, state, 256]); assert.equal(r.status, 0, r.stderr); return { spec, state }; };
const respond = (dir, g, request, name = 'request.json') => { const q = path.join(dir, name); fs.writeFileSync(q, JSON.stringify(request)); const r = run(['--response', g.spec, g.state, q, 256]); return { r, doc: r.status === 0 ? JSON.parse(r.stdout) : null }; };
const bits = d => d.seats.map(s => [s.seat, s.sampled.gain.gainBits, s.exact && s.exact.gainBits, s.exact && s.exact.bestResponseGainBits]);
const IDS = ['engine E1', 'engine E2', 'engine E3', 'engine E4', 'response life-cycle',
  ...['known-akq-river', 'flop3-kings-small', 'flop6-jack-small', 'icm8-bb-call-small'].flatMap(f => ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'].map(k => 'response ' + f + ' ' + k)),
  'limits L1', 'limits L2', 'limits L3', 'limits L4'];

// ---------------- mwcli --selftest58 ----------------
test('5.8 self-test: every check passes, the report lists each of them once, and the exit status says the same', t => {
  const d = tmp(t), r = run(['--selftest58', studies, d, 'all']);
  assert.equal(r.status, 0, r.stderr.slice(-2000));
  const doc = JSON.parse(fs.readFileSync(path.join(d, 'selftest58.json'), 'utf8')), line = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(doc.tool, 'mwcli selftest58'); assert.equal(doc.section, 'all');
  assert.deepEqual(doc.checks.map(c => c.section + ' ' + c.id).sort(), [...IDS].sort());
  for (const c of doc.checks) { assert.equal(c.status, 'passed', c.id + ': ' + c.detail); assert.ok(c.name.length > 20 && typeof c.detail === 'string'); }
  assert.equal(doc.passed, IDS.length); assert.equal(doc.failed, 0); assert.equal(doc.untested, 0);
  assert.deepEqual([line.passed, line.failed, line.untested], [IDS.length, 0, 0]);
  // what the checks measured, not only that they passed
  const of = id => doc.checks.find(c => c.section + ' ' + c.id === id);
  assert.match(of('engine E3').detail, /, 0 differ; \d+ hits, \d+ misses, [1-9]\d* evictions/);
  for (const f of ['known-akq-river', 'flop3-kings-small', 'flop6-jack-small', 'icm8-bb-call-small']) {
    assert.match(of('response ' + f + ' R1').detail, /largest difference 0$/, 'sigma must be preserved exactly');
    assert.match(of('response ' + f + ' R2').detail, /largest difference 0$/, 'the other seats must be frozen exactly');
    const share = +/\(([\d.e+-]+)%\)/.exec(of('response ' + f + ' R3').detail)[1]; assert.ok(share > 50 && share <= 100 + 1e-9, f + ': the short response training of the self-test finds ' + share + '% of exact NashConv');
  }
  assert.match(of('limits L1').detail, /status 400 after [\d.e-]+ s; checkpoint directory created: no/);
});
test('5.8 self-test: sections can be run alone; a wrong section or a missing folder is a usage error', t => {
  const d = tmp(t);
  let r = run(['--selftest58', studies, d, 'engine']); assert.equal(r.status, 0, r.stderr); assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'selftest58.json'), 'utf8')).checks.length, 4);
  r = run(['--selftest58', studies, d, 'limits']); assert.equal(r.status, 0, r.stderr); assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'selftest58.json'), 'utf8')).checks.length, 4);
  r = run(['--selftest58', studies, d, 'everything']); assert.equal(r.status, 2); assert.match(r.stderr, /section must be/);
  r = run(['--selftest58', path.join(d, 'nowhere'), d]); assert.equal(r.status, 2);
  r = run(['--selftest58']); assert.equal(r.status, 2); assert.match(r.stderr, /usage/);
});
test('5.8 self-test: without its fixtures every dependent check is untested or failed, none is passed, and the exit status is 1', t => {
  const d = tmp(t), empty = path.join(d, 'studies'), work = path.join(d, 'work'); fs.mkdirSync(empty); fs.mkdirSync(work);
  for (const section of ['response', 'limits']) {
    const r = run(['--selftest58', empty, work, section]); assert.equal(r.status, 1, section);
    const doc = JSON.parse(fs.readFileSync(path.join(work, 'selftest58.json'), 'utf8'));
    assert.ok(doc.checks.length >= 1); assert.equal(doc.passed, 0, section + ': nothing can pass without fixtures'); assert.ok(doc.untested >= 1);
    for (const c of doc.checks) assert.equal(c.status, 'untested', c.id);
  }
  // a fixture the engine refuses is untested as well
  fs.writeFileSync(path.join(empty, 'known-akq-river.emfix.json'), JSON.stringify({ variants: [{ nativeSpec: { protocol: 4, n: 99 } }] }));
  const r = run(['--selftest58', empty, work, 'response']); assert.equal(r.status, 1);
  const doc = JSON.parse(fs.readFileSync(path.join(work, 'selftest58.json'), 'utf8')); assert.equal(doc.passed, 0); assert.ok(doc.checks.some(c => c.id === 'known-akq-river' && c.status === 'untested'));
});

// ---------------- mwcli --response ----------------
test('5.8 response: malformed requests and impossible budgets are refused before anything is trained', t => {
  const d = tmp(t), g = trained(d, 'hu-river', 2000);
  const bad = [[{ bogus: 1 }, /unknown request field "bogus"/], [{ seats: [2] }, /seats must hold whole numbers from 0 to 1/], [{ seats: [0, 0] }, /seats lists a seat twice/], [{ seats: 'all' }, /seats must be an array/],
    [{ responseDeals: 0 }, /responseDeals must be a whole number/], [{ responseDeals: 1.5 }, /responseDeals must be a whole number/], [{ samples: 10 }, /samples must be a whole number from 1024/], [{ parallelSeats: 9 }, /parallelSeats must be a whole number from 1 to 8/],
    [{ exact: 'yes' }, /exact must be true or false/], [{ futureActions: 'guess' }, /futureActions must be auto, enumerate or sample/], [{ threads: 0 }, /threads must be a whole number/], [{ responseDeals: 10000001 }, /at most 10,000,000 updates per state \(nothing was started\)/]];
  for (const [q, re] of bad) { const { r } = respond(d, g, q); assert.equal(r.status, 2, JSON.stringify(q)); assert.match(r.stderr, re); assert.equal(r.stdout, ''); }
  fs.writeFileSync(path.join(d, 'broken.json'), '{"seats":'); let r = run(['--response', g.spec, g.state, path.join(d, 'broken.json'), 256]); assert.equal(r.status, 2); assert.match(r.stderr, /request/);
  fs.writeFileSync(path.join(d, 'ok.json'), '{}'); r = run(['--response', g.spec, path.join(d, 'missing.state'), path.join(d, 'ok.json'), 256]); assert.equal(r.status, 1); assert.match(r.stderr, /cannot read state/);
  r = run(['--response', g.spec, g.state]); assert.equal(r.status, 2); assert.match(r.stderr, /usage/);
  // a state of another game is refused by the engine, not trained against
  const other = trained(d, 'hu-turn', 500); r = run(['--response', g.spec, other.state, path.join(d, 'ok.json'), 256]); assert.equal(r.status, 1); assert.match(r.stderr, /refused/);
});
test('5.8 response: the result says what was measured and in which direction, and the exact values confirm it', t => {
  const d = tmp(t), g = trained(d, 'river3-chip', 20000);
  const { r, doc } = respond(d, g, { responseDeals: 200000, samples: 51200, seed: 58, exact: true });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(doc.tool, 'mwcli response 5.9'); assert.equal(doc.players, 3);   // 5.9: the tool names its release (tests/v59.test.js covers what 5.9 added to the result) assert.equal(doc.sourceDeals, 20000); assert.equal(doc.responseDealsPerSeat, 200000);
  assert.match(doc.direction, /lower bound of that seat's best-response gain.*lower bound of NashConv.*Not an upper bound; not exploitability/);
  assert.equal(doc.seats.length, 3);
  let sumGain = 0, sumBest = 0;
  for (const s of doc.seats) {
    const b = s.sampled, e = s.exact;
    assert.equal(b.calculation, 'response-5.9-paired-v2'); assert.equal(b.samples, 51200);   // 5.9: the default evaluation streams changed (the 5.8 streams give 'response-5.8-paired-v1': tests/v59.test.js) assert.equal(b.blockDeals, 1024);
    assert.match(b.estimand, /gain of one fixed response strategy of this seat/); assert.match(b.direction, /lower bound of this seat's best-response gain.*not an upper bound and not exploitability/);
    assert.ok(['sampled', 'enumerated'].includes(b.opponentActions));
    // exact: the response never gains more than the best response, and the best response is the same from both profiles
    assert.ok(e.available); assert.ok(e.gain <= e.bestResponseGain + 1e-9, 'seat ' + s.seat); assert.ok(e.bestResponseGain >= -1e-12);
    assert.ok(Math.abs(e.bestResponseValue - e.bestResponseValueFromResponseProfile) <= 1e-12 * Math.max(1, Math.abs(e.bestResponseValue)));
    assert.ok(Math.abs(e.responseValue - e.policyValue - e.gain) <= 1e-12);
    // the estimate from independent deals: inside its distribution-free interval, and within 5 standard errors
    assert.equal(b.bounded.withinBounds, true); assert.equal(b.bounded.calculation, 'study-5.5-bounded-eb-v1'); assert.ok(b.bounded.half > 0);
    assert.ok(Math.abs(b.gain.mean - e.gain) <= b.bounded.half, 'seat ' + s.seat + ': exact gain outside the bounded interval');
    assert.ok(b.gain.stdErr === 0 || Math.abs(b.gain.mean - e.gain) <= 5 * b.gain.stdErr, 'seat ' + s.seat);
    assert.ok(b.gain.sampleMin >= -b.bounded.sampleRange && b.gain.sampleMax <= b.bounded.sampleRange);
    assert.ok(b.bestResponseGainLowerBound.normal95 >= 0 && b.bestResponseGainLowerBound.bounded95 >= 0, 'lower bounds are floored at 0');
    assert.ok(b.bestResponseGainLowerBound.normal95 <= Math.max(0, b.gain.mean)); assert.ok(b.bestResponseGainLowerBound.bounded95 <= b.bestResponseGainLowerBound.normal95 + 1e-12);
    assert.ok(Math.abs(b.responseValue.mean - b.policyValue.mean - b.gain.mean) <= 1e-9);
    assert.equal(s.end.responseDeals, 200000); assert.equal(s.end.tableLimitReached, false); assert.ok(s.end.trained >= 1);
    sumGain += e.gain; sumBest += e.bestResponseGain;
  }
  const S = doc.summary;
  assert.equal(S.allSeats, true); assert.ok(Math.abs(S.exactSumOfSeatGains - sumGain) <= 1e-12); assert.ok(Math.abs(S.exactNashConv - sumBest) <= 1e-12);
  assert.ok(S.exactShare > 0.7 && S.exactShare <= 1 + 1e-9, 'share of exact NashConv found: ' + S.exactShare);
  assert.ok(Math.abs(S.sumOfSeatGains.mean - doc.seats.reduce((a, s) => a + s.sampled.gain.mean, 0)) <= 1e-12);
  assert.ok(Math.abs(S.sumOfSeatGains.stdErr - Math.hypot(...doc.seats.map(s => s.sampled.gain.stdErr))) <= 1e-12, 'independent seats: standard errors add in quadrature');
  assert.ok(S.sumOfSeatLowerBounds95 <= S.sumOfSeatGains.mean + 1e-12); assert.match(S.reading, /lower bound of NashConv/);
  // a subset of seats is labelled as such
  const part = respond(d, g, { responseDeals: 20000, samples: 2048, seats: [2] }); assert.equal(part.r.status, 0, part.r.stderr); assert.equal(part.doc.summary.allSeats, false); assert.match(part.doc.summary.reading, /not every seat was evaluated/);
});
test('5.8 response: the same bits for any number of threads and of parallel seats, different deals for another seed', t => {
  const d = tmp(t), g = trained(d, 'turn4', 20000);
  const base = { responseDeals: 100000, samples: 20480, seed: 58, exact: true };
  const a = respond(d, g, base), b = respond(d, g, { ...base, threads: 3 }), c = respond(d, g, { ...base, parallelSeats: 4, threads: 2 }), other = respond(d, g, { ...base, seed: 59 });
  for (const x of [a, b, c, other]) assert.equal(x.r.status, 0, x.r.stderr);
  assert.deepEqual(bits(b.doc), bits(a.doc)); assert.deepEqual(bits(c.doc), bits(a.doc));
  assert.notDeepEqual(other.doc.seats.map(s => s.sampled.gain.gainBits), a.doc.seats.map(s => s.sampled.gain.gainBits), 'another seed draws other deals');
  // the exact best response does not depend on the response seed (it is a property of the trained state)
  assert.deepEqual(other.doc.seats.map(s => s.exact.bestResponseGainBits), a.doc.seats.map(s => s.exact.bestResponseGainBits));
  // opponent actions enumerated or sampled: two unbiased estimates of the same gain, both around the exact value
  const en = respond(d, g, { ...base, futureActions: 'enumerate' }), sa = respond(d, g, { ...base, futureActions: 'sample' });
  for (const [x, name] of [[en, 'enumerated'], [sa, 'sampled']]) { assert.equal(x.r.status, 0, x.r.stderr); for (const s of x.doc.seats) { assert.equal(s.sampled.opponentActions, name); assert.ok(Math.abs(s.sampled.gain.mean - s.exact.gain) <= s.sampled.bounded.half); } }
  for (let i = 0; i < 4; i++) assert.ok(en.doc.seats[i].sampled.gain.stdErr <= sa.doc.seats[i].sampled.gain.stdErr * 1.05 + 1e-12, 'enumerating the opponents cannot add variance');
});
test('5.8 response: a saved response state holds sigma as "current" and the response as "average" for the ordinary evaluators', t => {
  const d = tmp(t), g = trained(d, 'hu-turn', 20000), prefix = path.join(d, 'resp-seat');
  const { r, doc } = respond(d, g, { responseDeals: 100000, samples: 4096, exact: true, saveStates: prefix }); assert.equal(r.status, 0, r.stderr);
  const q = policy => { const f = path.join(d, 'gain-' + policy + '.json'); fs.writeFileSync(f, JSON.stringify({ method: 'exact', policy, device: 'cpu', threads: 1 })); return f; };
  const original = JSON.parse(run(['--gain', g.spec, g.state, q('average'), 256]).stdout);
  for (const s of doc.seats) {
    const file = prefix + s.seat + '.state'; assert.equal(s.savedState, file); assert.ok(fs.existsSync(file));
    const cur = JSON.parse(run(['--gain', g.spec, file, q('current'), 256]).stdout), avg = JSON.parse(run(['--gain', g.spec, file, q('average'), 256]).stdout);
    // "current" of the response state is the trained state's average strategy, for EVERY seat: same values, same NashConv
    for (let p = 0; p < 2; p++) { assert.equal(cur.seats[p].policyValue, original.seats[p].policyValue); assert.equal(cur.seats[p].bestResponseValue, original.seats[p].bestResponseValue); }
    assert.equal(cur.nashConv, original.nashConv);
    // "average" differs only in this seat's strategy: its value is the response value, the opponent's best response is unchanged in kind
    assert.ok(Math.abs(avg.seats[s.seat].policyValue - s.exact.responseValue) <= 1e-12); assert.equal(avg.seats[s.seat].bestResponseValue, cur.seats[s.seat].bestResponseValue);
    assert.ok(avg.seats[s.seat].policyValue >= cur.seats[s.seat].policyValue - 0.05, 'the response should not lose much against sigma');
  }
  // the heads-up, chip-EV case: the two seat gains bound exploitability from below (NashConv / 2), never above the exact value
  assert.ok(doc.summary.exactSumOfSeatGains / 2 <= original.exploitability + 1e-9);
});
test('5.8 response: frozen batches with several threads, ICM, and hand groups', t => {
  const d = tmp(t);
  // bubble4: ICM, four deals per update and per-deal action streams, so response training itself uses the threads
  const b4 = trained(d, 'bubble4', 5000);
  const one = respond(d, b4, { responseDeals: 40000, samples: 4096, exact: true, threads: 1 }), four = respond(d, b4, { responseDeals: 40000, samples: 4096, exact: true, threads: 4 });
  assert.equal(one.r.status, 0, one.r.stderr); assert.equal(four.r.status, 0, four.r.stderr);
  assert.equal(one.doc.batchDeals, 4); assert.equal(one.doc.responseUpdatesPerSeat, 10000); assert.match(one.doc.seats[0].begin.deals, /frozen batches/);
  assert.deepEqual(bits(four.doc), bits(one.doc), 'response training in frozen batches must not depend on the threads');
  for (const s of one.doc.seats) { assert.ok(s.exact.gain <= s.exact.bestResponseGain + 1e-9); assert.ok(s.sampled.bounded.utilityHigh <= 50 + 1e-9 && s.sampled.bounded.utilityLow >= 0, 'ICM utilities lie between 0 and the first prize'); }
  // a study with hand groups (the shipped six-player flop fixture): no exact evaluation, the estimate alone
  const fx = JSON.parse(fs.readFileSync(path.join(studies, 'flop6-jack.emfix.json'), 'utf8')).variants[0].nativeSpec, spec = path.join(d, 'flop6-jack.spec.json'), state = path.join(d, 'flop6-jack.state');
  fs.writeFileSync(spec, JSON.stringify(fx)); let r = run([spec, 3000, 1, state, 512]); assert.equal(r.status, 0, r.stderr);
  const big = respond(d, { spec, state }, { responseDeals: 6000, samples: 2048, seats: [0, 5], parallelSeats: 2 }); assert.equal(big.r.status, 0, big.r.stderr);
  assert.equal(big.doc.players, 6); assert.equal(big.doc.seats.length, 2);
  for (const s of big.doc.seats) { assert.ok(Number.isFinite(s.sampled.gain.mean) && s.sampled.gain.stdErr >= 0); assert.equal(s.sampled.bounded.withinBounds, true); assert.equal(s.sampled.opponentActions, 'sampled'); assert.ok(s.end.newInformationSets >= 0 && s.begin.seatInformationSets > 0); assert.equal(s.exact, undefined); }
});
test('5.8 response: an independent Python implementation agrees (frozen opponents, exact values, direction, the estimate)', t => {
  const py = ['python3', 'python'].find(p => cp.spawnSync(p, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)']).status === 0);
  if (!py) return t.skip('no Python 3 interpreter on this machine');
  const d = tmp(t);
  for (const [key, updates] of [['hu-river', 20000], ['hu-turn', 5000], ['river3-chip', 5000]]) {
    const g = trained(d, key, updates), r = cp.spawnSync(py, [path.join(src, 'tools/independent_response58.py'), cli(), g.spec, g.state, path.join(d, 'ind-' + key), 100000, 20480, 58], { encoding: 'utf8', timeout: 1200000, maxBuffer: 64 << 20 });
    assert.equal(r.status, 0, key + ': ' + r.stderr.slice(-800) + r.stdout.slice(-800));
    const doc = JSON.parse(r.stdout); assert.equal(doc.ok, true);
    for (const s of doc.seats) {
      assert.equal(s.frozenOpponents.ok, true); assert.equal(s.frozenOpponents.rowsMissingInResponseState, 0); assert.equal(s.frozenOpponents.opponentRowsAdded, 0); assert.ok(s.frozenOpponents.opponentRowsCompared > 0 && s.frozenOpponents.ownRowsCompared > 0);
      assert.ok(s.largestExactDifference <= 1e-9); assert.equal(s.directionHolds, true); assert.equal(s.engineSampled.exactInsideBoundedInterval, true);
    }
  }
});

// ---------------- training is unchanged ----------------
// SHA-256 of the state the 5.7.1 binary (build 65e835e6b7060960) writes for games58 spec(key, seed 1), these updates, one thread.
const GOLDEN571 = [['hu-river', 20000, '0a776ad81d68f38d0f4d501be9816d638411fad4a0fe5721314f2cc13fac8083'], ['turn4', 20000, '112072d4fa99558fd8b00c83dc5111ce51c097d47cd46477a15580bdef4f14fb'],
  ['flop6w', 20000, 'ab11874815f96f2a8591bf6394be6d3101fa30403924ffc17b28572d6a48d6b1'], ['final8', 5000, 'e0c6e2bd6047100ee705c25aacef91ad418bc6989b9a6d098177512e322845bc'],
  ['bubble4', 5000, '6fcad44a8b622b8f8575d302e3986a0e29fd71a1de0a6849ba071375690d5f38'], ['short8-push', 3000, 'e58b3e05af8c91b595b9b3a0e6c818bc0934b6c16a2eb51d8fc43f12e03a7db0'],
  ['sidepot3-icm', 20000, 'b2ab100d0e4481c2f0388836078b321c5fde7946b2c41de69978ed415d076de5'], ['early3-flop', 5000, 'fc7dff85a4d64c8f46bade18ce701d7f8f6b1f3356b4f6ec003a436148b86ef0']];
test('5.8 training identity: eight reference games give the states of the 5.7.1 binary, byte for byte, with one and three threads', t => {
  const d = tmp(t);
  for (const [key, updates, want] of GOLDEN571) {
    const spec = specFile(d, key);
    for (const threads of [1, 3]) { const state = path.join(d, key + '.' + threads + '.state'), r = run([spec, updates, threads, state, 256]); assert.equal(r.status, 0, r.stderr); assert.equal(sha(state), want, key + ' with ' + threads + ' thread(s)'); }
    // stopped half way and continued: the same file
    const half = path.join(d, key + '.half.state'), full = path.join(d, key + '.cont.state');
    assert.equal(run([spec, updates / 2, 1, half, 256]).status, 0); assert.equal(run([spec, updates / 2, 2, full, 256, half]).status, 0); assert.equal(sha(full), want, key + ' continued');
  }
});
test('5.8 reference games: the five tournament-stage games are documented, keep the tournament structure and are accepted by the engine', t => {
  const d = tmp(t), added = games.games.filter(g => g.from === '5.8');
  assert.deepEqual(added.map(g => g.key), ['early3-flop', 'mid3-turn', 'short8-push', 'bubble5-icm', 'sidepot3-icm']);
  assert.equal(games.games.length, 15);
  for (const g of games.games) { assert.ok(g.stage.length > 5 && g.abstraction.length > 40, g.key + ' states its stage and its abstraction'); const s = games.spec(g.key); assert.ok(s.n >= 2 && s.n <= 8); }
  // eight-handed preflop: small blind 0.5, big blind 1, ante 0.1 each: 2.3 BB before the first action; no big-blind ante
  const s8 = games.spec('short8-push'); assert.equal(s8.n, 8); assert.deepEqual(s8.rules.posted, [0, 0, 0, 0, 0, 0, 0.5, 1]); assert.deepEqual(s8.rules.ownAnte, Array(8).fill(0.1));
  assert.ok(Math.abs(s8.rules.pot0 + s8.rules.posted.reduce((a, b) => a + b, 0) - 2.3) < 1e-12); assert.equal(s8.icm, undefined);
  const b5 = games.spec('bubble5-icm'); assert.deepEqual(b5.icm.payouts, [40, 27, 19, 14]); assert.deepEqual(b5.icm.start, [18, 9, 26, 5, 12]); assert.equal(b5.rules.posted[3], 0.5); assert.equal(b5.rules.posted[4], 1);
  const e3 = games.spec('early3-flop'); assert.ok(Math.abs(e3.rules.pot0 - 9.8) < 1e-12, 'blinds 1.5 + eight antes 0.8 + three times 2.5');
  assert.equal(e3.rules.sizes['3'].bets.length, 2); assert.equal(e3.rules.sizes['4'].bets.length, 1); assert.equal(e3.rules.sizes['5'].bets.length, 1);
  for (const g of added) { const spec = specFile(d, g.key), state = path.join(d, g.key + '.state'); const r = run([spec, 400, 1, state, 256]); assert.equal(r.status, 0, g.key + ': ' + r.stderr); }
});

// ---------------- the large-study limit ----------------
test('5.8 large studies: a budget above the limit is refused at once and names the largest supported budget; the limit itself is accepted', t => {
  const d = tmp(t), out = path.join(d, 'big.json'), ck = path.join(d, 'ck');
  const t0 = Date.now(), r = run(['--study', AKQ, out, 'quiet=1', 'seeds=1', 'budgets=1000,10000001', 'trainingStreams=5.10', 'checkpoint=' + ck]), ms = Date.now() - t0;
  assert.equal(r.status, 1); assert.match(r.stderr, /error 400: study budget too large: 10000001 sampled deals per seed need 10000001 training updates/);
  assert.match(r.stderr, /10 million iteration limit of one engine state\. Nothing was trained\. The largest budget this trainer supports is 10000000 sampled deals per seed/);
  assert.ok(ms < 5000, 'refused in ' + ms + ' ms (5.7.1 trained ten million deals first)'); assert.ok(!fs.existsSync(out), 'no result'); assert.ok(!fs.existsSync(ck), 'no checkpoint directory');
  // 5.7.1 behaviour, for the record: the old binary accepts the same options and fails only after training
  const ok = run(['--study', AKQ, out, 'quiet=1', 'seeds=1', 'budgets=10000000', 'trainingStreams=5.10', 'timeLimitSeconds=0.2', 'checkpoint=off']); assert.equal(ok.status, 0, ok.stderr);
  const doc = JSON.parse(fs.readFileSync(out, 'utf8')); assert.equal(doc.completion.complete, false); assert.equal(doc.variants[0].perSeed[0].budgets[0].budgetDeals, 10000000);
  // the trainer's own limit is unchanged and stated in the header
  assert.match(fs.readFileSync(path.join(src, 'native/mw.h'), 'utf8'), /#define MW_MAX_UPDATES 10000000LL/);
  let x = run([path.join(d, 'none.json'), 10000001, 1, path.join(d, 'x.state')]); assert.equal(x.status, 2); assert.match(x.stderr, /0 to 10,000,000/);
});

// ---------------- reference responses for the Windows validation ----------------
test('5.8 reference responses: this build reproduces the recorded bits (validation/5.8/windows/response)', t => {
  const dir = path.join(root, 'validation/5.8/windows/response'), file = path.join(dir, 'golden58.json');
  if (!fs.existsSync(file)) return t.skip('validation/5.8/windows/response/golden58.json is not in this tree (it is recorded from the final build)');
  const g = JSON.parse(fs.readFileSync(file, 'utf8')), d = tmp(t); assert.ok(g.cases.length >= 4);
  for (const c of g.cases) {
    const spec = path.join(dir, c.spec), state = path.join(d, c.name + '.state');
    assert.equal(run([spec, c.updates, 1, state, c.memoryMiB]).status, 0); assert.equal(sha(state), c.stateSha256, c.name);
    // 5.9: the recorded bits are those of the 5.8 evaluation streams, which 5.9 draws on request (its default streams differ)
    const q58 = path.join(d, c.name + '-request.json'); fs.writeFileSync(q58, JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(dir, c.request), 'utf8')), randomStreams: '5.8' }));
    const r = run(['--response', spec, state, q58, c.memoryMiB]); assert.equal(r.status, 0, r.stderr);
    const got = JSON.parse(r.stdout).seats.map(s => s.seat + ':' + s.sampled.gain.gainBits + ':' + s.exact.gainBits + ':' + s.exact.bestResponseGainBits);
    assert.deepEqual(got, c.seatBits, c.name);
  }
});

// ---------------- the desktop host: an answer means the next checkpoint request may start ----------------
// Through 5.7.1 the host released its checkpoint lock AFTER sending the answer, so a client that sent the next checkpoint
// request at once could be refused by a host that had already finished (409 "Another checkpoint operation is active",
// 503 "Another checkpoint write is in progress"). The window is tiny on an idle machine and grows with load: it is why
// checkpoint tests of v36 and v37 failed in full regression runs and passed alone. The test hook keeps the answering
// thread busy for 250 ms after its answer, which made every request below fail with the 5.7.1 order.
test('5.8 desktop host: after an answered checkpoint request the next one is accepted at once (the load-sensitive refusals of 5.6 to 5.7.1)', async t => {
  const { withHost, home } = require('./checkpoint_host');
  const archive = fs.readFileSync(path.join(root, 'validation/3.7/fixtures/eight-seat-3.6.emstudy'));
  const upload = (url, route, data) => fetch(url + '/api/checkpoint/' + route, { method: 'POST', headers: { 'X-EightMax': '1' }, body: data });
  await withHost(home(t), { EIGHTMAX_TEST_AFTER_CHECKPOINT_RESPONSE_MS: '250' }, async (api, url) => {
    for (let i = 0; i < 4; i++) {
      const t0 = Date.now(), w = await upload(url, 'write', archive); assert.equal(w.status, 200, 'write ' + i);
      const r = await api('checkpoint/native-latest', ''); assert.equal(r.status, 200, 'restore right after the answered write, round ' + i + ': ' + JSON.stringify(await r.json().catch(() => null)));
      const st = await (await api('checkpoint/status')).json(); assert.equal(st.generation, String(i + 1));
      assert.ok(Date.now() - t0 < 5000);
    }
    // an operation that is really still running is refused as before: a second write while the first one's body is incomplete
    const net = require('node:net'), port = +new URL(url).port;
    const slow = net.connect(port, '127.0.0.1'); await new Promise(r => slow.once('connect', r));
    slow.on('error', () => {}); slow.write('POST /api/checkpoint/write HTTP/1.1\r\nHost: 127.0.0.1:' + port + '\r\nX-EightMax: 1\r\nContent-Length: ' + archive.length + '\r\n\r\n'); slow.write(archive.subarray(0, 1000));
    let receiving = false; for (let i = 0; i < 100 && !receiving; i++) { const p = await (await api('checkpoint/progress')).json(); receiving = p.active && p.receivedBytes === 1000; if (!receiving) await new Promise(r => setTimeout(r, 10)); }
    assert.ok(receiving, 'the host is receiving the first write');
    const second = await upload(url, 'write', archive); assert.equal(second.status, 503, 'a write is refused while another write is being received');
    const restore = await api('checkpoint/native-latest', ''); assert.equal(restore.status, 409, 'and so is a restore');
    await api('checkpoint/cancel', {}); slow.end(archive.subarray(1000, 1001)); let ended = false;
    for (let i = 0; i < 200 && !ended; i++) { ended = !(await (await api('checkpoint/progress')).json()).active; if (!ended) await new Promise(r => setTimeout(r, 10)); }
    assert.ok(ended, 'the cancelled write has ended');
    assert.equal((await upload(url, 'write', archive)).status, 200, 'and a write is accepted again once that one has ended');
  });
});

// ---------------- the Windows script, the launchers and the workflow (static) ----------------
test('5.8 Windows validation: the script plans and imports every 5.8 check, the launchers run the self-tests first, the workflow gates on them', t => {
  const ps = fs.readFileSync(path.join(src, 'tools/validate_windows58.ps1'), 'utf8'), version = fs.readFileSync(path.join(src, 'VERSION'), 'utf8').trim();
  assert.ok(version.length > 0); assert.match(ps, /\$Release = '5\.8'/); assert.match(ps, /tool = 'validate_windows58\.ps1'/);   // 5.9: this is the script of the 5.8 release, kept as shipped; validate_windows59.ps1 is checked by tests/v59.test.js
  for (const s of ["Run-Section 'self-test 5.8'", "Run-Section 'trained response'", "Run-Section 'self-test 5.7.1'", "Run-Section 'golden states'", "Run-Section 'GPU'", "'--selftest58', $studies, $dir, 'all'", "validation\\5.8\\windows\\response", "'every expected 5.8 check is in the report'", "'parallel seats give the same bits'"]) assert.ok(ps.includes(s), s);
  // every check id of the self-test is expected by the script (built there from the same names)
  for (const id of ['engine E1', 'engine E4', 'response life-cycle', 'limits L1', 'limits L4']) assert.ok(ps.includes("'" + id + "'"), id);
  for (const f of ['known-akq-river', 'flop3-kings-small', 'flop6-jack-small', 'icm8-bb-call-small']) assert.ok(ps.includes("'" + f + "'"), f);
  // every planned check is recorded somewhere, and every 'Plan' has a class the report understands
  const plans = [...ps.matchAll(/^Plan '([^']+)' '([^']+)' '([^']+)'/gm)]; assert.ok(plans.length >= 45);
  for (const [, , , cls] of plans) assert.ok(['gate', 'environment', 'hardware', 'information'].includes(cls));
  // each check 5.8 plans is planned once and recorded (other sections build some of their names at run time)
  for (const name of ['mwcli --selftest58 ran and wrote its report', 'every expected 5.8 check is in the report', 'the 5.8 report agrees with the exit status of mwcli', 'every reference response reproduced', 'parallel seats give the same bits']) {
    assert.equal(plans.filter(p => p[2] === name).length, 1, 'planned once: ' + name); assert.ok(ps.split("Check '" + plans.find(p => p[2] === name)[1] + "' '" + name + "'").length >= 2, 'planned but never recorded: ' + name);
  }
  // PowerShell 5.1 compatibility: no PowerShell 7-only operators, balanced braces and parentheses (the project's static linter)
  const py = ['python3', 'python'].find(p => cp.spawnSync(p, ['-c', 'pass']).status === 0);
  if (py) { const r = cp.spawnSync(py, [path.join(src, 'tools/ps_lint571.py'), path.join(src, 'tools/validate_windows58.ps1')], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stdout + r.stderr); }
  for (const [name, needs] of [['Run 5.8 Windows validation.bat', ['mwcli.exe --selftest57 ', 'mwcli.exe --selftest571 ', 'mwcli.exe --selftest58 ', 'validate_windows58.ps1" %*', 'Windows-selftest58-5.8.json']], ['Run 5.8 focused validation.bat', ['mwcli.exe --selftest58 ', 'validate_windows58.ps1" -Focused %*']], ['Run 5.8 response example.bat', ['mwcli.exe --response ', 'example-request.json']]]) {
    const f = path.join(root, name); if (!fs.existsSync(f)) continue;   // the launchers live in the release root, not in a bare source tree
    const b = fs.readFileSync(f); assert.ok(!/[^\x00-\x7f]/.test(b.toString('latin1')), name + ' is ASCII'); const text = b.toString('latin1');
    assert.ok(!/[^\r]\n/.test(text), name + ' has CRLF line ends'); for (const n of needs) assert.ok(text.includes(n), name + ': ' + n); assert.match(text, /exit \/b %\w+%\r\n$/);
  }
  const wf = path.join(root, '.github/workflows/windows.yml');
  // 5.9: the workflow runs the 5.9 script (which contains the 5.8 sections); it still runs the 5.8 self-test and this test file
  if (fs.existsSync(wf)) { const y = fs.readFileSync(wf, 'utf8'); for (const s of ['--selftest58 source/studies', 'windows-selftest58.json', 'source/tests/v58.test.js']) assert.ok(y.includes(s), s); assert.ok(!/continue-on-error:\s*true/.test(y), 'no gate is allowed to fail silently'); }
});
