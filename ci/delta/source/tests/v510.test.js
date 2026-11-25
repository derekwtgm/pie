'use strict';
// EightMax 5.10 regression tests.
//   5.10 adds an experimental training estimator, "rbes" (Rao-Blackwellised external sampling, native/es_rbes510.hpp):
//   one traversal per (deal, updating seat) carries every hand of the seat's range that is compatible with the
//   sampled board and opponents' hands, and an opponent's terminal children are taken in expectation. The default
//   trainer is unchanged: it writes the states of 5.9 byte for byte (its only change is a cache of Detailed hand-group
//   identifiers, which cannot change a number). These tests cover
//     - mwcli --selftest510: every check, its exit status, sections, and that nothing passes without fixtures;
//     - the estimator against exact targets: mwcli --estimator-check on reference games of every kind (the estimator's
//       own code over every outcome of its sampling against a brute-force walk), and an INDEPENDENT Python
//       implementation of the targets (tools/independent_rbes510.py) against the exact expectation written by
//       tests/rbes510.cpp;
//     - the estimator against the 4.7 own-hand estimator, written by other hands: the same strategy to rounding;
//     - variance: the estimator's increments have a smaller variance than the default's on a game with ranges;
//     - the default trainer: the states of the unchanged 5.9 program on 20 reference games (recorded hashes);
//     - determinism, threads, continuation, the key caches, checkpoint identity, refused configurations;
//     - a convergence reference: on games with ranges the exact NashConv after a fixed budget is far below the
//       default trainer's (fixed seeds: a regression check; the experiment is validation/5.10/convergence);
//     - the trained response with "responseEstimator":"rbes", and that the default response is the 5.9 response;
//     - studies with estimator=rbes, their checkpoints and the refusal to resume under another estimator;
//     - the reference games of tools/games510.js, the experiment runner (a dry run) and the Windows validation
//       script of 5.10, its launchers and reference files.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const build = require('./native_build');
const games = require('../tools/games510.js');
const src = path.resolve(__dirname, '..'), root = path.resolve(src, '..'), studies = path.join(src, 'studies');
const cli = () => process.env.EM_TEST_MWCLI || build.cli().cli;
const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'em510-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const run = (args, env = {}) => cp.spawnSync(cli(), args.map(String), { encoding: 'utf8', timeout: 1800000, maxBuffer: 256 << 20, env: { ...process.env, ...env } });
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const RB = { estimator: 'rbes' };
const specFile = (dir, key, seed = 1, extra = {}, tag = '') => { const f = path.join(dir, key + tag + '.spec.json'); fs.writeFileSync(f, JSON.stringify({ ...games.spec(key, seed), ...extra })); return f; };
const fixtureSpec = (dir, name, extra = {}, tag = '') => { const f = path.join(dir, name + tag + '.spec.json'); fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(studies, name + '.emfix.json'), 'utf8').replace(/^﻿/, '')).variants[0].nativeSpec, ...extra })); return f; };
const train = (spec, updates, state, threads = 1, input = null, env = {}, mem = 512) => run([spec, updates, threads, state, mem, ...(input ? [input] : [])], env);
const trainOk = (...a) => { const r = train(...a); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };
const nashConv = (dir, spec, state) => { const q = path.join(dir, 'gain.json'); fs.writeFileSync(q, JSON.stringify({ method: 'exact', policy: 'average', device: 'cpu', threads: 1, timeLimitMs: 1800000, maxVisits: 2000000000, memoryMiB: 1024 })); const r = run(['--gain', spec, state, q, 512]); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout).seats.reduce((a, s) => a + s.bestResponseValue - s.policyValue, 0); };
const python = () => ['python3', 'python'].find(p => cp.spawnSync(p, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)']).status === 0);
const compilerSkip = process.platform === 'win32' && !process.env.EM_TEST_CXX ? 'needs a C++ compiler (set EM_TEST_CXX)' : false;
const IDS = ['estimator X1', 'estimator X2', 'estimator X3', 'estimator X4', 'estimator X5', 'estimator X6', 'estimator X7', 'estimator X8', 'training D1', 'training D2', 'training R1', 'training R2', 'training R3', 'training R4', 'training R5', 'training R6',
  'checkpoint C1', 'checkpoint C2', 'checkpoint C3', 'limits L1', 'limits L2'];

// ---------------- mwcli --selftest510 ----------------
test('5.10 self-test: every check passes, the report lists each of them once, and the exit status says the same', { timeout: 1800000 }, t => {
  const d = tmp(t), r = run(['--selftest510', studies, d, 'all']);
  assert.equal(r.status, 0, r.stdout + r.stderr.slice(-3000));
  const doc = JSON.parse(fs.readFileSync(path.join(d, 'selftest510.json'), 'utf8')), line = JSON.parse(r.stdout);
  assert.equal(doc.tool, 'mwcli selftest510'); assert.ok([fs.readFileSync(path.join(src, 'VERSION'), 'utf8').trim(), 'development'].includes(doc.version), doc.version);   // a build without build_info.h calls itself development assert.equal(doc.failed, 0); assert.equal(doc.untested, 0); assert.equal(doc.passed, IDS.length);
  assert.deepEqual(doc.checks.map(c => c.section + ' ' + c.id), IDS); assert.ok(doc.checks.every(c => c.status === 'passed' && c.name.length > 20 && c.detail.length > 5));
  assert.equal(line.passed, doc.passed); assert.equal(line.failed, 0);
  // the work folder holds the report and nothing else: every state and spec the checks wrote was removed
  assert.deepEqual(fs.readdirSync(d), ['selftest510.json']);
  // the exact checks really enumerated: more outcomes than deals, and the six-player check more than a hundred thousand
  const x8 = doc.checks.find(c => c.id === 'X8'); assert.match(x8.detail, /6 seats/); assert.ok(+/(\d+) traversal outcomes/.exec(x8.detail)[1] > 100000, x8.detail);
});
test('5.10 self-test: sections can be run alone; a wrong section or a missing folder is a usage error; nothing passes without fixtures', { timeout: 600000 }, t => {
  const d = tmp(t);
  for (const [section, n] of [['estimator', 8], ['checkpoint', 3], ['limits', 2]]) { const w = path.join(d, section), r = run(['--selftest510', studies, w, section]); assert.equal(r.status, 0, r.stderr.slice(-2000)); const doc = JSON.parse(fs.readFileSync(path.join(w, 'selftest510.json'), 'utf8')); assert.equal(doc.section, section); assert.equal(doc.passed, n); assert.ok(doc.checks.every(c => c.section === section)); }
  assert.equal(run(['--selftest510', studies, d, 'everything']).status, 2); assert.equal(run(['--selftest510', path.join(d, 'no-such-folder'), d, 'all']).status, 2); assert.equal(run(['--selftest510']).status, 2);
  const empty = path.join(d, 'empty'); fs.mkdirSync(empty); const r = run(['--selftest510', empty, path.join(d, 'w'), 'all']);
  assert.equal(r.status, 1); const doc = JSON.parse(fs.readFileSync(path.join(d, 'w', 'selftest510.json'), 'utf8')); assert.equal(doc.passed, 0, 'no check may pass without its fixture'); assert.ok(doc.untested + doc.failed >= 15);
});

// ---------------- the estimator against exact targets ----------------
test('5.10 estimator: the exact expectation of its increments equals the brute-force target on reference games of every kind (mwcli --estimator-check)', { timeout: 1800000 }, t => {
  const d = tmp(t);
  // [game, updates before the tables are frozen, deals, extra spec options]: chip EV and ICM, river to preflop starts, two to eight seats, side pots, Compact groups, both variants and both walks
  for (const [key, updates, deals, extra] of [['hu-river', 4000, 60, {}], ['hu-river', 4000, 30, { rbesOpponentTerminals: 'sampled' }], ['hu-river', 4000, 30, { rbesWalk: 'reference' }], ['river3-chip', 4000, 30, {}], ['hu-turn', 4000, 60, {}],
    ['turn4', 4000, 8, {}], ['mid3-turn', 4000, 3, {}], ['sidepot3-icm', 4000, 30, {}], ['bubble4', 1000, 30, {}], ['bubble5-icm', 1000, 6, {}], ['final8', 1000, 2, {}], ['short8-push', 1000, 1, {}], ['flop6', 2000, 2, {}],
    ['rg-hu-river', 4000, 30, {}], ['rg-river3', 4000, 20, {}], ['rg-icm3-river', 4000, 20, {}], ['rg-turn4', 4000, 6, {}], ['rg-flop3c', 6000, 2, {}], ['rg-flop6c', 2000, 1, {}]]) {
    const spec = specFile(d, key, 77, { ...RB, ...extra }), r = run(['--estimator-check', spec, updates, deals]);
    assert.equal(r.status, 0, key + ' ' + JSON.stringify(extra) + ': ' + r.stdout + r.stderr); const x = JSON.parse(r.stdout);
    assert.equal(x.passed, true, key); assert.ok(x.entriesCompared > 0 && x.traversalOutcomesEnumerated >= x.seatDeals, key); assert.ok(x.largestDifferenceOverScale <= 1e-11, key + ' ' + x.largestDifferenceOverScale);
    assert.ok(x.largestProductionReferenceDifferenceOverScale <= 1e-11, key); assert.ok(x.largestOutcomeProbabilityError <= 1e-9, key); assert.equal(x.estimator, extra.rbesOpponentTerminals ? 'rbes-5.10-v1-sampled-terminals' : 'rbes-5.10-v1');
  }
  const spec = specFile(d, 'hu-river', 77, RB), plain = specFile(d, 'hu-river', 77, {}, '-plain');
  assert.equal(run(['--estimator-check', spec, 100]).status, 2); assert.equal(run(['--estimator-check', spec, 100, 0]).status, 2); assert.equal(run(['--estimator-check', spec, -1, 5]).status, 2);
  const r = run(['--estimator-check', plain, 100, 5]); assert.equal(r.status, 1); assert.match(r.stderr, /"estimator":"rbes"/);
});
let harnessExe = null;
function harness() {
  if (!harnessExe) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'em510h-')), obj = path.join(d, 'json.o'); harnessExe = path.join(d, 'rbes510' + (process.platform === 'win32' ? '.exe' : ''));
    cp.execFileSync(process.env.EM_TEST_CC || 'gcc', ['-O2', '-c', path.join(src, 'native/json.c'), '-o', obj]);
    cp.execFileSync(process.env.EM_TEST_CXX || 'g++', ['-std=c++20', '-O2', '-march=x86-64', '-ffp-contract=off', '-I' + path.join(src, 'native'), path.join(__dirname, 'rbes510.cpp'), obj, '-lpthread', ...(process.platform === 'win32' ? ['-static'] : ['-ldl']), '-o', harnessExe], { stdio: 'ignore' });
    process.on('exit', () => fs.rmSync(d, { recursive: true, force: true }));
  }
  return harnessExe;
}
test('5.10 estimator: an independent Python implementation of the targets agrees with the exact expectation over every deal and every sampling outcome (tests/rbes510.cpp total, tools/independent_rbes510.py)', { skip: compilerSkip, timeout: 1800000 }, t => {
  const py = python(); if (!py) { t.skip('needs Python 3.8 or newer'); return; }
  const d = tmp(t), exe = harness();
  for (const [key, extra] of [['hu-river', {}], ['hu-river', { rbesOpponentTerminals: 'sampled' }], ['hu-river', { rbesWalk: 'reference' }], ['river3-chip', {}], ['hu-turn', {}]]) {
    const spec = specFile(d, key, 77, { ...RB, ...extra }), dump = path.join(d, key + '.exact.json');
    const r = cp.spawnSync(exe, ['total', spec, '5000', dump], { encoding: 'utf8', timeout: 900000 }); assert.equal(r.status, 0, key + ': ' + r.stderr);
    const p = cp.spawnSync(py, [path.join(src, 'tools/independent_rbes510.py'), spec, dump], { encoding: 'utf8', timeout: 900000, maxBuffer: 64 << 20 }); assert.equal(p.status, 0, key + ': ' + p.stdout.slice(0, 1500) + p.stderr);
    const rep = JSON.parse(p.stdout), c = rep.checks[0]; assert.equal(rep.allPassed, true); assert.ok(c.entriesCompared >= 200 && c.entriesWithNonzeroTarget >= 100, key); assert.equal(c.targetEntriesMissingFromTheDump, 0);
    assert.ok(c.largestRegretDifferenceOverScale <= 1e-12 && c.largestAverageDifferenceOverScale <= 1e-12, key + ' ' + c.largestRegretDifferenceOverScale); assert.ok(c.engineBruteForceDifferenceOverScale <= 1e-12);
    assert.equal(c.handTuplesEnumeratedIndependently * (key === 'hu-turn' ? 44 : 1), c.dealsEnumeratedByTheEngine, 'both programs enumerated the same deals');
  }
  // the checker is not vacuous: a dump whose regrets are scaled by 1.001 is rejected
  const spec = specFile(d, 'hu-river', 77, RB), dump = path.join(d, 'hu-river.exact.json'), bad = path.join(d, 'bad.json');
  cp.spawnSync(exe, ['total', spec, '5000', dump], { encoding: 'utf8' }); const doc = JSON.parse(fs.readFileSync(dump, 'utf8')); for (const r of doc.rows) for (let a = 0; a < r.k; a++) r.mean[a] *= 1.001; fs.writeFileSync(bad, JSON.stringify(doc));
  const p = cp.spawnSync(py, [path.join(src, 'tools/independent_rbes510.py'), spec, bad], { encoding: 'utf8' }); assert.equal(p.status, 1); assert.equal(JSON.parse(p.stdout).allPassed, false);
});
test('5.10 estimator: with sampled terminal children it trains the strategy of the 4.7 own-hand estimator, an implementation written independently of it (exact NashConv to rounding)', { timeout: 900000 }, t => {
  const d = tmp(t);
  for (const key of ['hu-river', 'river3-chip', 'hu-turn', 'rg-turn4', 'bubble4']) {
    const per = games.spec(key, 12).batchDeals, values = [];
    for (const [tag, extra] of [['own', { ownHandEnumeration: true }], ['rb', { ...RB, rbesOpponentTerminals: 'sampled' }], ['ref', { ...RB, rbesOpponentTerminals: 'sampled', rbesWalk: 'reference' }]]) {
      const spec = specFile(d, key, 12, extra, '-' + tag), state = path.join(d, key + '-' + tag + '.state'); trainOk(spec, 20000 / per, state); values.push(nashConv(d, spec, state));
    }
    for (const v of values.slice(1)) assert.ok(Math.abs(v - values[0]) <= 1e-8 * Math.max(1e-3, values[0]), key + ': ' + values.join(' '));
  }
});
test('5.10 estimator: the variance of its regret increments is a small fraction of the default estimator\'s on a game with ranges, and both agree with each other in the mean (tests/rbes510.cpp mc)', { skip: compilerSkip, timeout: 900000 }, t => {
  const d = tmp(t), exe = harness(), spec = specFile(d, 'rg-river3', 77, RB), a = path.join(d, 'default.json'), b = path.join(d, 'rbes.json');
  const r = cp.spawnSync(exe, ['mc', spec, '20000', '60000', a, b], { encoding: 'utf8', timeout: 800000 }); assert.equal(r.status, 0, r.stderr); const x = JSON.parse(r.stdout);
  assert.ok(x.regretVarianceRatioRbesOverDefault > 0 && x.regretVarianceRatioRbesOverDefault < 0.15, 'regret variance ratio ' + x.regretVarianceRatioRbesOverDefault);
  assert.ok(x.averageVarianceRatioRbesOverDefault > 0 && x.averageVarianceRatioRbesOverDefault < 0.15, 'average variance ratio ' + x.averageVarianceRatioRbesOverDefault);
  // two unbiased estimators of the same quantity: per entry, the difference of their means in units of its standard error
  const A = JSON.parse(fs.readFileSync(a, 'utf8')), B = JSON.parse(fs.readFileSync(b, 'utf8')); let n = 0, worst = 0, sq = 0;
  A.rows.forEach((ra, i) => { const rb = B.rows[i]; for (let k = 0; k < 2 * ra.k; k++) { if (ra.nonzeroDeals[k] < 300 || rb.nonzeroDeals[k] < 300) continue; const se = Math.hypot(ra.standardError[k], rb.standardError[k]); if (!(se > 0)) continue; const z = (ra.mean[k] - rb.mean[k]) / se; n++; sq += z * z; worst = Math.max(worst, Math.abs(z)); } });
  assert.ok(n > 200, n + ' entries'); assert.ok(worst < 5.5, 'largest |z| ' + worst + ' over ' + n + ' entries'); assert.ok(Math.sqrt(sq / n) < 1.25, 'rms z ' + Math.sqrt(sq / n));
  // with a minimum number of nonzero deals only the rows that reach it in BOTH estimators are written, the same rows in both files, with the same numbers
  const a2 = path.join(d, 'default-300.json'), b2 = path.join(d, 'rbes-300.json'), r2 = cp.spawnSync(exe, ['mc', spec, '20000', '60000', a2, b2, '300'], { encoding: 'utf8', timeout: 800000 }); assert.equal(r2.status, 0, r2.stderr);
  const A2 = JSON.parse(fs.readFileSync(a2, 'utf8')), B2 = JSON.parse(fs.readFileSync(b2, 'utf8')), id = r => r.path.join('') + '|' + r.hand + '|' + r.cards.join(','), full = new Map(A.rows.map((r, i) => [id(r), i]));
  const want = A.rows.filter((ra, i) => ra.nonzeroDeals.some((h, k) => h >= 300 && B.rows[i].nonzeroDeals[k] >= 300));
  assert.ok(A2.rows.length > 20 && A2.rows.length < A.rows.length, A2.rows.length + ' of ' + A.rows.length); assert.equal(A2.rows.length, want.length); assert.equal(B2.rows.length, want.length);
  A2.rows.forEach((ra, i) => { const j = full.get(id(ra)); assert.ok(j !== undefined); assert.equal(id(B2.rows[i]), id(ra)); assert.deepEqual(ra.mean, A.rows[j].mean); assert.deepEqual(B2.rows[i].mean, B.rows[j].mean); assert.deepEqual(ra.nonzeroDeals, A.rows[j].nonzeroDeals); });
});
test('5.10 estimator: the sampler draws every non-terminal action with the probability the traversal claims and never a terminal child; a wrong claim is detected (tests/rbes510.cpp pick)', { skip: compilerSkip, timeout: 600000 }, t => {
  const d = tmp(t), exe = harness(), spec = specFile(d, 'rg-river3', 77, RB);
  const r = cp.spawnSync(exe, ['pick', spec, '1000', '400000'], { encoding: 'utf8', timeout: 500000, maxBuffer: 64 << 20 }); assert.equal(r.status, 0, r.stderr); const x = JSON.parse(r.stdout);
  assert.equal(x.test, 'pick'); assert.equal(x.terminalChildrenDrawn, 0); assert.ok(x.cases.length >= 100, x.cases.length + ' decisions'); assert.ok(x.exploreMix > 0 && Math.abs(x.exploreKeep + x.exploreMix - 1) < 1e-12);
  // chi-square of the counts against the claimed probabilities, as a standard normal (Wilson-Hilferty); Bonferroni over the decisions at 0.05
  const z = (count, claimed) => { const n = count.reduce((p, q) => p + q, 0); let chi = 0, df = -1; claimed.forEach((q, i) => { if (q > 0) { chi += (count[i] - n * q) ** 2 / (n * q); df++; } }); return (Math.cbrt(chi / df) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df)); };
  let worst = -Infinity, wrongDetected = 0, wrongTried = 0, masks = new Set(), smallest = 1;
  for (const c of x.cases) {
    assert.equal(c.count.reduce((p, q) => p + q, 0), x.draws); c.claimed.forEach((q, i) => { if (q === 0) assert.equal(c.count[i], 0, 'a terminal child was drawn'); else smallest = Math.min(smallest, q); });
    assert.ok(Math.abs(c.claimed.reduce((p, q) => p + q, 0) - 1) < 1e-12); worst = Math.max(worst, z(c.count, c.claimed)); masks.add(c.k + ':' + c.terminalMask);
    if (c.sigmaShape === 0) { const live = c.claimed.filter(q => q > 0).length, uniform = c.claimed.map(q => q > 0 ? 1 / live : 0); if (Math.max(...c.claimed) > 1.5 / live) { wrongTried++; if (z(c.count, uniform) > 20) wrongDetected++; } }   // the same counts against a claim that is not the sampler's
  }
  assert.ok(worst < 3.37, 'largest standardised chi-square ' + worst); assert.ok(wrongTried >= 10 && wrongDetected === wrongTried, wrongDetected + ' of ' + wrongTried); assert.ok(masks.size >= 60, masks.size + ' decision shapes'); assert.ok(smallest < 0.05, 'rare actions are among the cases: ' + smallest);
  const bad = cp.spawnSync(exe, ['pick', spec, '1000'], { encoding: 'utf8' }); assert.equal(bad.status, 2);
});

// ---------------- the default trainer ----------------
test('5.10 default trainer: the states of the unchanged 5.9 program on 20 reference games and 5 fixtures (hashes recorded from the 5.9 binary)', { timeout: 900000 }, t => {
  const d = tmp(t), golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/golden510.json'), 'utf8'));
  assert.equal(golden.recordedFrom.build, '00600c81455ead44'); assert.ok(golden.states.length >= 25);
  for (const g of golden.states) {
    const spec = g.fixture ? fixtureSpec(d, g.fixture, g.extra || {}) : specFile(d, g.game, g.seed, g.extra || {}), state = path.join(d, 's.state');
    trainOk(spec, g.updates, state, g.threads || 1, null, { EIGHTMAX_THREAD_CHOICE: 'fixed' }); assert.equal(sha(state), g.sha256, (g.fixture || g.game) + ' ' + JSON.stringify(g.extra || {}));
  }
});
test('5.10 default trainer: its info names no experimental algorithm, its state header is the 5.9 header, and the Detailed key cache is reported and changes nothing', { timeout: 600000 }, t => {
  const d = tmp(t), spec = specFile(d, 'hu-river', 3), state = path.join(d, 'a.state'), info = trainOk(spec, 2000, state);
  assert.equal(info.trainer.estimator, 'external sampling MCCFR'); assert.equal(info.trainer.validatedDefault, true); assert.equal(info.trainer.algorithm, undefined); assert.equal(info.trainer.rbes, undefined);
  const head = JSON.parse(run(['--state-info', state]).stdout); assert.ok(!JSON.stringify(head).includes('estimator'), 'no estimator field in a default state');
  const det = fixtureSpec(d, 'flop3-kings-detailed'), a = path.join(d, 'd1.state'), b = path.join(d, 'd2.state'), i1 = trainOk(det, 4000, a), i2 = trainOk(det, 4000, b, 1, null, { EIGHTMAX_KEYCACHE_MIB: '0' });
  assert.equal(sha(a), sha(b)); assert.ok(i1.handGroups.keyCache.hits > 1000 && i1.handGroups.keyCache.MiB > 0); assert.equal(i2.handGroups.keyCache.hits, 0);
  const cmp = fixtureSpec(d, 'flop3-kings'), i3 = trainOk(cmp, 1000, a); assert.equal(i3.handGroups.keyCache, undefined, 'Compact keys are computed as in 5.9');
});

// ---------------- determinism, checkpoints, limits ----------------
test('5.10 rbes: the same state for a repeated run, for 1 to 4 threads, for the 5.6 batch update and without its key cache; stop and continue is byte for byte', { timeout: 900000 }, t => {
  const d = tmp(t);
  for (const [key, extra, updates] of [['rg-turn3', {}, 3000], ['rg-flop3c', { batchDeals: 16, actionStreams: 'deal' }, 300], ['rg-bubble4', {}, 1500], ['final8', {}, 1500], ['rg-flop6c', { batchDeals: 64, actionStreams: 'deal' }, 60]]) {
    const spec = specFile(d, key, 31, { ...RB, ...extra }), s = n => path.join(d, key + '-' + n + '.state'), batch = JSON.parse(fs.readFileSync(spec, 'utf8')).batchDeals > 1;
    trainOk(spec, updates, s('a')); trainOk(spec, updates, s('b')); trainOk(spec, updates, s('c'), 1, null, { EIGHTMAX_RBES_KEYCACHE_MIB: '0' });
    assert.equal(sha(s('a')), sha(s('b')), key + ' repeat'); assert.equal(sha(s('a')), sha(s('c')), key + ' key cache off');
    if (batch) { for (const n of [2, 3, 4]) { trainOk(spec, updates, s('t'), n, null, { EIGHTMAX_THREAD_CHOICE: 'fixed' }); assert.equal(sha(s('a')), sha(s('t')), key + ' ' + n + ' threads'); }
      trainOk(spec, updates, s('l'), 3, null, { EIGHTMAX_LEGACY_BATCH: '1' }); assert.equal(sha(s('a')), sha(s('l')), key + ' 5.6 batch update'); trainOk(spec, updates, s('m'), 4); assert.equal(sha(s('a')), sha(s('m')), key + ' measured thread choice'); }
    const third = Math.floor(updates / 3); trainOk(spec, third, s('p'), batch ? 2 : 1); trainOk(spec, updates - third, s('q'), batch ? 3 : 1, s('p')); assert.equal(sha(s('a')), sha(s('q')), key + ' continued');
  }
});
test('5.10 rbes: its info and state name the algorithm; a state continues only under the algorithm that trained it, and an earlier program would refuse it by its study identifier', { timeout: 600000 }, t => {
  const d = tmp(t), plain = specFile(d, 'rg-turn4', 5), rb = specFile(d, 'rg-turn4', 5, RB, '-rb'), sm = specFile(d, 'rg-turn4', 5, { ...RB, rbesOpponentTerminals: 'sampled' }, '-sm');
  const a = path.join(d, 'a.state'), b = path.join(d, 'b.state'), c = path.join(d, 'c.state'), out = path.join(d, 'out.state');
  const ia = trainOk(plain, 2000, a), ib = trainOk(rb, 2000, b), ic = trainOk(sm, 2000, c);
  assert.equal(ib.trainer.algorithm, 'rbes-5.10-v1'); assert.equal(ib.trainer.experimentalEstimator, true); assert.equal(ib.trainer.estimator, 'Rao-Blackwellised external sampling MCCFR'); assert.equal(ia.trainer.estimator, 'external sampling MCCFR'); assert.equal(ib.trainer.validatedDefault, false); assert.equal(ib.trainer.rbes.opponentTerminalChildren, 'exact'); assert.ok(ib.trainer.rbes.handsPerSeatWalk > 5 && ib.trainer.rbes.rowIncrements > 0 && ib.trainer.rbes.exactTerminalChildren > 0);
  assert.equal(ic.trainer.algorithm, 'rbes-5.10-v1-sampled-terminals'); assert.equal(ic.trainer.rbes.exactTerminalChildren, 0);
  const ids = [ia, ib, ic].map(i => i.studyId); assert.equal(new Set(ids).size, 3, 'three study identifiers: ' + ids); for (const id of ids) assert.match(id, /^[0-9a-f]{16}$/);
  const hb = run(['--state-info', b]).stdout; assert.match(hb, /rbes-5\.10-v1/); assert.ok(hb.includes(ib.studyId));
  for (const [spec, input, why] of [[rb, a, /default trainer/], [plain, b, /experimental/], [sm, b, /different/], [rb, c, /different/]]) {
    const r = train(spec, 100, out, 1, input); assert.equal(r.status, 1); assert.match(r.stderr, /was refused/); assert.match(r.stderr, why); assert.ok(!fs.existsSync(out), 'nothing written');
  }
  // the unchanged path still works: each state continues under its own spec
  for (const [spec, input] of [[plain, a], [rb, b], [sm, c]]) { assert.equal(train(spec, 100, out, 1, input).status, 0); fs.rmSync(out); }
});
test('5.10 rbes: configurations it was not validated for are refused before training; a table limit stops cleanly and the state resumes to the uninterrupted one', { timeout: 900000 }, t => {
  const d = tmp(t), out = path.join(d, 'out.state');
  for (const extra of [{ weighting: 'dcfr' }, { regretMatching: 'plus' }, { ownHandEnumeration: true }, { opponentEnumeration: 'river' }, { opponentEnumeration: 'river-cross' }, { terminalBaseline: true }, { terminalExpectation: true }, { chanceSampling: 'latin' }, { opponentExploration: 0 }]) {
    const spec = specFile(d, 'hu-river', 2, { ...RB, ...extra }), r = train(spec, 100, out); assert.equal(r.status, 1, JSON.stringify(extra)); assert.match(r.stderr, /rbes/); assert.ok(!fs.existsSync(out));
  }
  for (const [extra, why] of [[{ estimator: 'fast' }, /Unknown estimator/], [{ estimator: 3 }, /Unknown estimator/], [{ rbesOpponentTerminals: 'sampled' }, /needs estimator rbes/], [{ rbesWalk: 'reference' }, /needs estimator rbes/], [{ ...RB, rbesOpponentTerminals: 'x' }, /rbesOpponentTerminals/], [{ ...RB, rbesWalk: 'x' }, /rbesWalk/]]) {
    const r = train(specFile(d, 'hu-river', 2, extra), 100, out); assert.equal(r.status, 1); assert.match(r.stderr, why);
  }
  assert.equal(train(specFile(d, 'hu-river', 2, { estimator: 'external' }), 100, out).status, 0, '"external" names the default trainer');
  const ext = sha(out); trainOk(specFile(d, 'hu-river', 2), 100, out); assert.equal(sha(out), ext, 'and writes its state');
  // uniform weighting is supported
  assert.equal(train(specFile(d, 'hu-river', 2, { ...RB, weighting: 'uniform' }), 500, out).status, 0);
  const g = fixtureSpec(d, 'flop3-kings', RB), small = path.join(d, 'small.state'), cont = path.join(d, 'cont.state'), whole = path.join(d, 'whole.state');
  const is = trainOk(g, 4000, small, 1, null, {}, 6); assert.equal(is.limitReached, true); assert.ok(is.trainingDeals > 0 && is.trainingDeals < 4000, 'stopped at ' + is.trainingDeals);
  const ic = trainOk(g, 4000 - is.trainingDeals, cont, 1, small), iw = trainOk(g, 4000, whole); assert.equal(ic.limitReached, false); assert.equal(iw.limitReached, false); assert.equal(sha(cont), sha(whole));
});

// ---------------- convergence reference, response, studies ----------------
test('5.10 convergence reference: on games with ranges the exact NashConv after a fixed budget is far below the default trainer\'s at the same seed (a regression check, not the experiment)', { timeout: 900000 }, t => {
  const d = tmp(t);
  for (const [key, updates, bound] of [['rg-hu-river', 40000, 0.35], ['rg-river3', 40000, 0.35], ['rg-icm3-river', 40000, 0.3], ['rg-turn4', 40000, 0.5]]) {
    const a = specFile(d, key, 9), b = specFile(d, key, 9, RB, '-rb'), sa = path.join(d, key + '-a.state'), sb = path.join(d, key + '-b.state'); trainOk(a, updates, sa); trainOk(b, updates, sb);
    const na = nashConv(d, a, sa), nb = nashConv(d, b, sb); assert.ok(nb > 0 && na > 0); assert.ok(nb < bound * na, key + ': rbes ' + nb + ' against default ' + na);
  }
});
test('5.10 trained response: "responseEstimator":"rbes" trains a response whose statements hold against the exact values and which finds more at the same budget; the default response is unchanged', { timeout: 900000 }, t => {
  const d = tmp(t), spec = fixtureSpec(d, 'flop3-kings-small'), state = path.join(d, 's.state'); trainOk(spec, 20000, state);
  const respond = (request, env = {}) => { const q = path.join(d, 'rq.json'); fs.writeFileSync(q, JSON.stringify(request)); const r = run(['--response', spec, state, q, 512], env); return { r, doc: r.status === 0 ? JSON.parse(r.stdout) : null }; };
  const base = { responseDeals: 10000, samples: 51200, seed: 7, exact: true }, a = respond(base), b = respond({ ...base, responseEstimator: 'rbes' }), c = respond({ ...base, responseEstimator: 'external' });
  assert.equal(a.r.status, 0, a.r.stderr); assert.equal(b.r.status, 0, b.r.stderr); assert.equal(c.r.status, 0);
  assert.equal(a.doc.responseEstimator, undefined, 'the default result has the 5.9 fields'); assert.equal(b.doc.responseEstimator, 'rbes-5.10-v1'); assert.equal(b.doc.seats[0].begin.estimator, 'rbes-5.10-v1'); assert.equal(a.doc.seats[0].begin.estimator, undefined);
  const bits = x => x.seats.map(s => [s.sampled.gain.gainBits, s.exact.gainBits]); assert.deepEqual(bits(a.doc), bits(c.doc), '"external" is the default response, bit for bit');
  for (const x of [a.doc, b.doc]) { const g = x.summary.againstExact; assert.ok(g.simultaneousHolds && g.simultaneousNashConvBoundHolds && g.pooledAllSeatsHolds && g.pooledBestSubsetHolds); assert.ok(x.summary.exactSumOfSeatGains <= x.summary.exactNashConv + 1e-12); }
  assert.ok(b.doc.summary.exactSumOfSeatGains > a.doc.summary.exactSumOfSeatGains + 0.05, 'rbes response ' + b.doc.summary.exactSumOfSeatGains + ' against ' + a.doc.summary.exactSumOfSeatGains + ' of ' + a.doc.summary.exactNashConv);
  assert.equal(respond({ ...base, responseEstimator: 'fast' }).r.status, 2); assert.equal(respond({ ...base, responseEstimator: 1 }).r.status, 2);
  // a state trained by rbes is measured like any other (default response), and with the rbes response
  const rs = fixtureSpec(d, 'flop3-kings-small', RB, '-rb'), rstate = path.join(d, 'r.state'); trainOk(rs, 20000, rstate);
  const q = path.join(d, 'rq.json'); fs.writeFileSync(q, JSON.stringify(base)); const r = run(['--response', rs, rstate, q, 512]); assert.equal(r.status, 0, r.stderr); const doc = JSON.parse(r.stdout);
  assert.ok(doc.summary.againstExact.simultaneousHolds); assert.ok(doc.summary.exactNashConv < a.doc.summary.exactNashConv, 'the rbes-trained strategy has the smaller exact NashConv at this budget and seed');
});
test('5.10 study: estimator=rbes completes, names the algorithm, resumes from its checkpoint to the same result, and its checkpoint is refused by the default trainer', { timeout: 900000 }, t => {
  const d = tmp(t), fx = path.join(studies, 'flop3-kings-small.emfix.json'), ck = path.join(d, 'ck'), a = path.join(d, 'a.json'), b = path.join(d, 'b.json'), c = path.join(d, 'c.json');
  const common = ['variants=baseline', 'seeds=2', 'budgets=4000,20000', 'quiet=1'];
  const points = x => x.variants.map(v => v.perSeed.map(s => s.budgets.map(p => [s.seed, p.budgetDeals, p.deals, p.rows, JSON.stringify(p.frequency), JSON.stringify(p.ev), p.quality])));
  const ra = run(['--study', fx, a, ...common, 'estimator=rbes', 'checkpoint=off']); assert.equal(ra.status, 0, ra.stderr); const A = JSON.parse(fs.readFileSync(a, 'utf8'));
  assert.equal(A.run.trainer.estimator, 'rbes'); assert.equal(A.completion.complete, true); assert.equal(A.variants[0].perSeed[0].budgets[0].trainer.algorithm, 'rbes-5.10-v1'); assert.ok(points(A)[0][0].length === 2 && points(A)[0][0][1][2] === 20000);
  // interrupted by a time limit of zero seconds per call until complete, then compared with the uninterrupted result
  let n = 0, done = false; while (!done && n++ < 60) { const r = run(['--study', fx, b, ...common, 'estimator=rbes', 'checkpoint=' + ck, ...(n > 1 ? ['resume=1'] : []), 'timeLimitSeconds=0.05']); assert.ok(r.status === 0 || r.status === 1, r.stderr); done = fs.existsSync(b) && JSON.parse(fs.readFileSync(b, 'utf8')).completion.complete; }
  assert.ok(done, 'the study completed after ' + n + ' resumed runs'); const B = JSON.parse(fs.readFileSync(b, 'utf8'));
  assert.deepEqual(points(B), points(A), 'the resumed study has the measurements of the uninterrupted one');
  const rc = run(['--study', fx, c, ...common, 'checkpoint=' + ck, 'resume=1']); assert.notEqual(rc.status, 0, 'the default trainer must not resume a checkpoint of rbes'); assert.match(rc.stderr, /study resume refused: the checkpoint belongs to a different study/); assert.match(rc.stderr, /trainer/);
  assert.equal(run(['--study', fx, c, ...common, 'estimator=fast', 'checkpoint=off']).status, 2);
});

// ---------------- processing modes (the CUDA scoring route beside the estimator; SIMULATED driver) ----------------
// tests/cuda_driver_fixture.cpp is a test double of the CUDA driver (v50.test.js); it is not a GPU. What is checked:
// the scheduler that decides where the showdowns of a batch are scored treats rbes as it treats the default trainer,
// and no mode changes a state.
const cudaWin = process.platform === 'win32';
const cudaSkip = cudaWin ? (!process.env.EM_TEST_CUDA_FIXTURE && 'Windows: set EM_TEST_CUDA_FIXTURE to the CUDA test-double DLL (the CI workflow builds it)') : process.platform !== 'linux' ? 'needs the Linux or Windows CUDA test double' : (!build.cli().fixtureDir && 'the CUDA test double was not built');
test('5.10 processing modes: rbes beside the CUDA scoring route (simulated driver): CPU Only, Automatic, Hybrid and GPU-Preferred write one state; the driver is opened when it is for the default trainer and nothing leaks', { skip: cudaSkip, timeout: 900000 }, t => {
  const d = tmp(t), base = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/es-six-weighted.json'), 'utf8')); base.batchDeals = 64; const out = {};
  const driverEnv = cudaWin ? { EM_TEST_CUDA_LIBRARY: process.env.EM_TEST_CUDA_FIXTURE } : { LD_LIBRARY_PATH: build.cli().fixtureDir };
  for (const est of ['external', 'rbes']) for (const device of ['cpu', 'auto', 'hybrid', 'gpu']) {
    const spec = path.join(d, est + '-' + device + '.json'), state = path.join(d, est + '-' + device + '.state'), stats = path.join(d, est + '-' + device + '.stats.json'); fs.writeFileSync(spec, JSON.stringify({ ...base, device, ...(est === 'rbes' ? RB : {}) }));
    // 12 updates of 64 deals: with 208 exact hands a seat rbes creates about a thousand rows a deal, and a longer run would end at the table limit
    const r = cp.spawnSync(cli(), [spec, '12', '2', state, '512'], { encoding: 'utf8', env: { ...process.env, ...driverEnv, EM_FIXTURE_STATS: stats }, timeout: 600000 }); assert.equal(r.status, 0, est + ' ' + device + ': ' + r.stderr);
    out[est + device] = { info: JSON.parse(r.stdout), sha: crypto.createHash('sha256').update(fs.readFileSync(state)).digest('hex'), driver: fs.existsSync(stats) ? JSON.parse(fs.readFileSync(stats, 'utf8')) : null };
  }
  for (const est of ['external', 'rbes']) for (const device of ['auto', 'hybrid', 'gpu']) assert.equal(out[est + device].sha, out[est + 'cpu'].sha, est + ': ' + device + ' writes the CPU Only state');
  assert.notEqual(out.rbescpu.sha, out.externalcpu.sha); assert.equal(out.rbesgpu.info.trainer.algorithm, 'rbes-5.10-v1'); assert.equal(out.rbesgpu.info.trainingDeals, 768); assert.equal(out.rbesgpu.info.limitReached, false); assert.equal(out.externalgpu.info.trainingDeals, 768);
  for (const device of ['cpu', 'auto', 'hybrid', 'gpu']) {
    const a = out['external' + device], b = out['rbes' + device];
    assert.equal(b.driver === null, a.driver === null, device + ': the driver is loaded for rbes exactly when it is for the default trainer'); assert.equal(b.info.scheduling.trainingPath, 'external sampling'); assert.equal(b.info.scheduling.decision, a.info.scheduling.decision, device + ': scheduling decision');
    if (b.driver) { assert.equal(b.driver.cuInitCalls, 1); assert.equal(b.driver.liveBytesAtExit, 0); assert.equal(b.driver.leakedBlocks, 0); assert.equal(b.driver.failedAllocations, 0); }
  }
  assert.equal(out.rbescpu.driver, null); assert.equal(out.rbesauto.driver, null, 'Automatic does not open CUDA for a small job'); assert.ok(out.rbeshybrid.driver && out.rbesgpu.driver, 'Hybrid and GPU-Preferred open the (simulated) device');
});

// ---------------- tools and release files ----------------
test('5.10 reference games: every game of tools/games510.js builds, the 5.10 games have ranges, and the earlier keys give the specs they gave', t => {
  const g58 = require('../tools/games58.js'); assert.equal(games.added.length, 9);
  for (const g of games.games) { const s = games.spec(g.key, 3); assert.ok(s.n >= 2 && s.n <= 8 && s.hands.length === s.n, g.key); if (g58.byKey[g.key]) assert.deepEqual(s, g58.spec(g.key, 3), g.key + ' is the 5.8 game'); }
  for (const k of games.added) { const s = games.spec(k, 3), g = games.byKey[k]; assert.equal(g.from, '5.10'); assert.ok(g.stage && g.abstraction.length > 40, k); assert.ok(Math.max(...s.hands.map(h => h.length)) >= 4, k); assert.equal(!!s.groupKeys, /c$/.test(k), k + ': Compact groups exactly for the keys that end in c'); assert.ok(!s.turnGroups && !s.riverGroups, k + ' is supported by rbes'); }
  assert.ok(games.spec('rg-hu-river', 3).hands.every(h => h.length >= 50)); assert.equal(!!games.spec('rg-icm3-river', 3).icm, true); assert.equal(games.spec('rg-bubble4', 3).batchDeals, 4);
  const r = cp.spawnSync(process.execPath, [path.join(src, 'tools/games510.js'), 'list'], { encoding: 'utf8' }); assert.equal(r.status, 0); assert.equal(r.stdout.trim().split('\n').length, games.games.length);
});
test('5.10 experiment runner: a dry run of validation/5.10/convergence/convergence510.py writes its plan first, records every cell, and finds the default trainer identical to itself', { timeout: 1800000 }, t => {
  const py = python(), runner = path.join(root, 'validation/5.10/convergence/convergence510.py'); if (!py || !fs.existsSync(runner) || process.platform === 'win32') { t.skip('needs Python and the release tree (Linux)'); return; }
  const d = tmp(t), timed = path.join(d, 'timed'), obj = path.join(d, 'json.o'), mw = path.join(d, 'mw.o'), out = path.join(d, 'out');
  try { cp.execFileSync('gcc', ['-O2', '-c', path.join(src, 'native/json.c'), '-o', obj]); cp.execFileSync('g++', ['-std=c++20', '-O2', '-march=x86-64', '-ffp-contract=off', '-I' + path.join(src, 'native'), path.join(root, 'validation/5.10/convergence/timed510.cpp'), path.join(src, 'native/mw.cpp'), obj, '-lpthread', '-ldl', '-o', timed], { stdio: 'ignore' }); } catch (e) { t.skip('no compiler'); return; }
  void mw;
  const r = cp.spawnSync(py, [runner, 'exact', root, cli(), cli(), timed, timed, out, '2'], { encoding: 'utf8', timeout: 1500000, env: { ...process.env, EM_DRY_RUN: '1' } }); assert.equal(r.status, 0, r.stderr.slice(-2000));
  const plan = JSON.parse(fs.readFileSync(path.join(out, 'plan.json'), 'utf8')), sum = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8')), rows = fs.readFileSync(path.join(out, 'raw.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(plan.dryRun, true); assert.ok(fs.statSync(path.join(out, 'plan.json')).mtimeMs <= fs.statSync(path.join(out, 'raw.jsonl')).mtimeMs + 1); assert.equal(sum.errorCount, 0);
  assert.equal(rows.length, plan.games.length * plan.seeds.length * (3 * plan.deals.length + 2 * plan.times.length + 1)); assert.equal(sum.defaultTrainerIdentity.identical, sum.defaultTrainerIdentity.compared); assert.ok(sum.defaultTrainerIdentity.compared > 0);
  assert.equal(sum.rule.defaultReplaced, false); assert.ok(sum.contrasts.some(c => c.family === 'primary') && sum.contrasts.every(c => c.verdict));
  assert.notEqual(cp.spawnSync(py, [runner, 'exact', root, cli(), cli(), timed, timed, out, '2'], { encoding: 'utf8', env: { ...process.env, EM_DRY_RUN: '1' } }).status, 0, 'an existing output directory is refused');
  // an interrupted run: a finished one is not resumed; with the last unit cut off, --resume keeps the complete units, runs the cut-off one again and reaches the same equal-deals states
  const again = extra => cp.spawnSync(py, [runner, 'exact', root, cli(), cli(), timed, timed, out, '2', ...extra], { encoding: 'utf8', timeout: 1500000, env: { ...process.env, EM_DRY_RUN: '1' } });
  const done = again(['--resume']); assert.notEqual(done.status, 0); assert.match(done.stderr, /completed and analysed/);
  const perUnit = 3 * plan.deals.length + 2 * plan.times.length + 1, lines = fs.readFileSync(path.join(out, 'raw.jsonl'), 'utf8').trim().split('\n'), last = JSON.parse(lines[lines.length - 1]), cut = lines.filter(l => { const q = JSON.parse(l); return !(q.game === last.game && q.seed === last.seed); });
  const partial = lines.filter(l => { const q = JSON.parse(l); return q.game === last.game && q.seed === last.seed; }).slice(0, 4); assert.equal(cut.length, lines.length - perUnit);
  fs.unlinkSync(path.join(out, 'summary.json')); fs.writeFileSync(path.join(out, 'raw.jsonl'), cut.concat(partial).join('\n') + '\n'); fs.mkdirSync(path.join(out, 'work', last.game + '-' + last.seed), { recursive: true }); fs.writeFileSync(path.join(out, 'work', last.game + '-' + last.seed, 'left.state'), 'x');
  const res = again(['--resume']); assert.equal(res.status, 0, res.stderr.slice(-2000)); const note = JSON.parse(fs.readFileSync(path.join(out, 'resume-1.json'), 'utf8'));
  assert.equal(note.rowsKept, cut.length); assert.equal(note.rowsOfUnitsCutOffDropped, 4); assert.deepEqual(note.unitsCutOff, [last.game + '-' + last.seed]); assert.equal(fs.readFileSync(path.join(out, 'raw.before-resume-1.jsonl'), 'utf8').trim().split('\n').length, cut.length + 4);
  const rows2 = fs.readFileSync(path.join(out, 'raw.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)), key = q => [q.game, q.seed, q.arm, q.kind, q.budget].join('|'), shas = list => new Map(list.filter(q => q.kind === 'deals').map(q => [key(q), q.sha + '|' + q.nashConv]));
  assert.equal(rows2.length, rows.length); assert.deepEqual([...shas(rows2)].sort(), [...shas(rows)].sort()); assert.equal(new Set(rows2.map(key)).size, rows2.length, 'every cell once');
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'plan.json'), 'utf8')).written, plan.written, 'the plan is not rewritten'); assert.ok(!fs.existsSync(path.join(out, 'work')));
  // other arguments than the plan's: refused
  fs.unlinkSync(path.join(out, 'summary.json')); const other = cp.spawnSync(py, [runner, 'exact', root, cli(), cli(), timed, timed, out, '3', '--resume'], { encoding: 'utf8', env: { ...process.env, EM_DRY_RUN: '1' } }); assert.notEqual(other.status, 0); assert.match(other.stderr, /stored plan differs/);
});
test('5.10 Windows validation: the script plans and imports every 5.10 check, the focused mode covers what 5.10 added, the launchers run the self-test first, the reference files are complete', t => {
  const file = path.join(src, 'tools/validate_windows510.ps1'), ps = fs.readFileSync(file, 'utf8'), version = fs.readFileSync(path.join(src, 'VERSION'), 'utf8').trim();
  assert.ok(['5.10', '5.11'].includes(version), version); assert.match(ps, /\$Release = '5\.10'/);   // 5.11: the 5.10 script is kept as it ran on Windows; validate_windows511.ps1 is the script of this release (tests/v511.test.js)
  assert.match(ps, /tool = 'validate_windows510\.ps1'/); assert.ok(!/[^\x00-\x7f]/.test(ps), 'the script is ASCII');
  for (const s of ["Run-Section 'self-test 5.10'", "Run-Section 'estimator 5.10'", "Run-Section 'self-test 5.9'", "Run-Section 'self-test 5.8'", "Run-Section 'self-test 5.7.1'", "Run-Section 'trained response'", "Run-Section 'golden states'", "Run-Section 'threads'", "Run-Section 'GPU'", "Run-Section 'refused study'",
    "'--selftest510', $studies, $dir, 'all'", "'--estimator-check'", "validation\\5.10\\windows\\estimator", "validation\\5.9\\windows\\response", "'every expected 5.10 check is in the report'"]) assert.ok(ps.includes(s), s);
  for (const id of IDS) assert.ok(ps.includes("'" + id + "'"), 'expected check ' + id);
  const plans = [...ps.matchAll(/^Plan '([^']+)' '([^']+)' '([^']+)'/gm)]; assert.ok(plans.length >= 63, plans.length + ' planned checks');
  for (const [, , , cls] of plans) assert.ok(['gate', 'environment', 'hardware', 'information'].includes(cls));
  for (const name of ['mwcli --selftest510 ran and wrote its report', 'every expected 5.10 check is in the report', 'the 5.10 report agrees with the exit status of mwcli', 'identical rbes state for every thread count', 'rbes state equals the Linux build', 'rbes thread scaling on this PC',
    'exact check of the estimator on a table trained on this PC', 'default and rbes training throughput on this PC', 'rbes: every processing mode writes the same state', 'rbes processing modes on this PC', 'every 5.9 reference response reproduced', 'every golden state reproduced', 'identical state for every thread count']) {
    assert.equal(plans.filter(p => p[2] === name).length, 1, 'planned once: ' + name); const sec = plans.find(p => p[2] === name)[1];
    assert.ok(ps.includes("Check '" + sec + "' '" + name + "'") || ps.includes("Add-Check '" + sec + "' '" + name + "'"), 'planned but never recorded: ' + name);
  }
  const focus = /\$focusSections = @\(([^)]*)\)/.exec(ps)[1]; for (const s of ["'self-test 5.10'", "'estimator 5.10'", "'golden states'", "'threads'", "'integrity'"]) assert.ok(focus.includes(s), 'focused: ' + s);
  const py = python(); if (py) { const r = cp.spawnSync(py, [path.join(src, 'tools/ps_lint571.py'), file], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stdout + r.stderr); }
  const pw = ['pwsh', 'powershell', path.join(os.homedir(), '.dotnet/tools/pwsh')].find(p => { try { return cp.spawnSync(p, ['-NoProfile', '-Command', 'exit 0'], { timeout: 60000 }).status === 0; } catch { return false; } });
  if (pw) { const r = cp.spawnSync(pw, ['-NoProfile', '-Command', "$e = $null; $t = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('" + file.replace(/'/g, "''") + "', [ref]$t, [ref]$e); if ($e.Count) { $e | ForEach-Object { $_.ToString() }; exit 1 }"], { encoding: 'utf8', timeout: 120000 }); assert.equal(r.status, 0, r.stdout + r.stderr); }
  for (const [name, needs] of [['Run 5.10 Windows validation.bat', ['mwcli.exe --selftest57 ', 'mwcli.exe --selftest571 ', 'mwcli.exe --selftest58 ', 'mwcli.exe --selftest59 ', 'mwcli.exe --selftest510 ', 'validate_windows510.ps1" %*', 'Windows-selftest510-5.10.json', 'Windows-validation-5.10.json', 'if not "%selftest510_result%"=="0" if "%eightmax_result%"=="0" set "eightmax_result=1"']],
    ['Run 5.10 focused validation.bat', ['mwcli.exe --selftest510 ', 'validate_windows510.ps1" -Focused %*', 'Windows-focused-validation-5.10.json']]]) {
    const f = path.join(root, name); if (!fs.existsSync(f)) continue;   // the launchers live in the release root, not in a bare source tree
    const b = fs.readFileSync(f); assert.ok(!/[^\x00-\x7f]/.test(b.toString('latin1')), name + ' is ASCII'); const text = b.toString('latin1');
    assert.ok(!/[^\r]\n/.test(text), name + ' has CRLF line ends'); for (const n of needs) assert.ok(text.includes(n), name + ': ' + n); assert.match(text, /exit \/b %\w+%\r\n$/);
    assert.match(text, /if not exist "Windows-(focused-)?validation-5\.10\.json" if "%eightmax_result%"=="0" set "eightmax_result=2"/, name + ': a missing report is not a pass');
    assert.ok(!text.includes('-5.9.json') && !text.includes('validate_windows59'), name + ' writes 5.10 reports only');
  }
  const dir = path.join(root, 'validation/5.10/windows/estimator');
  if (fs.existsSync(dir)) {
    const ref = JSON.parse(fs.readFileSync(path.join(dir, 'reference.json'), 'utf8')); assert.match(ref.threads.stateSha256, /^[0-9a-f]{64}$/);
    for (const f of [ref.threads.spec, ref.exactCheck.spec, ...ref.throughput.flatMap(x => [x.defaultSpec, x.rbesSpec])]) assert.ok(fs.existsSync(path.join(dir, f)), f);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, ref.threads.spec), 'utf8')).estimator, 'rbes'); assert.equal(JSON.parse(fs.readFileSync(path.join(dir, ref.throughput[0].defaultSpec), 'utf8')).estimator, undefined);
  }
});
