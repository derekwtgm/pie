'use strict';
// EightMax 4.7 regression tests.
//   Priority 1/14 - independent reference suite (source/reference): known game values,
//     exact best responses, ICM and side-pot properties, CFR-family convergence, estimator
//     unbiasedness on explicit trees.
//   Priority 2 - experimental own-hand enumeration estimator: refused combinations, trainer
//     metadata, deterministic continuation, thread independence, engine-level unbiasedness
//     against the validated default; the default trainer keeps the golden 4.4-4.6 bytes.
//   Priority 4/7/8 - mwcli --verify (modes A-D), --compare, --monitor; the JavaScript
//     analytics (dashboard) agree with the native ones bit for bit.
//   Priority 6 - the dashboard's live monitor against the native host.
//   Priority 11 - compressed checkpoints (EMZ1).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
const E = require('../tools/loadlib');
for (const l of ['lib_runouts', 'lib_wide', 'lib_river', 'lib_dashboard']) require('../web/' + l);
const { withHost, home } = require('./checkpoint_host');
const build = require('./native_build');
const tool = () => process.env.EM_TEST_MWCLI || build.cli().cli;
const skip = !tool() && (build.cli().why || 'no native CLI');
const hostSkip = !(process.env.EM_TEST_HOST || build.host().exe) && 'native host unavailable';
const cxx = (() => { try { cp.execFileSync(process.env.CXX || 'g++', ['--version'], { stdio: 'ignore' }); return process.env.CXX || 'g++'; } catch { return null; } })();
const spec45 = path.join(__dirname, '..', '..', 'validation', '4.5', 'fixtures', 'icm-final8.spec.json');
const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'em47-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const sha = f => require('node:crypto').createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const GOLDEN_300 = 'aa80974199182afa91d5a47166d32af0eb00ecff3ba334593eb5a359cc2e22b8';
const cli = (args, env = {}) => cp.spawnSync(tool(), args.map(String), { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 600000, maxBuffer: 1 << 28 });
const json = r => { assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };
const GAMES = {
  river3: { board: 'Ks8d5h2c2s', common: 6, stacks: [4, 12, 30], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc'], streets: { river: { bets: '75,a', raises: 'a', maxBets: 2 } } },
  bubble4: { preflop: { mode: 'shove' }, dealt: 4, common: 0, board: '', stacks: [12, 7, 20, 4], ranges: ['AsAh,7c2d:0.5', 'KsKh:0.75,8c3d', 'QsQh,6d5d', 'JsJh:0.5,9s8s'], icm: { payouts: [50, 30, 20] }, batchDeals: 4, actionStreams: 'deal' },
  final8: { preflop: { mode: 'shove' }, board: '', dealt: 8, common: 0, stacks: [30, 22, 15, 40, 9, 18, 25, 12], ranges: ['AsAh', 'KsKh', 'QsQh', 'JsJh', 'TsTh', '9s9h', '8s8h', '7s7h'], icm: { payouts: [30, 20, 14, 11, 9, 7, 5, 4] }, batchDeals: 4, actionStreams: 'deal' },
  huturn: { board: 'Ks8d5h2c', common: 8, stacks: [12, 12], ranges: ['AhKh,KdQd,8s8h,JsTs', 'AsKd,5d5c,8h7h,JdTd'], streets: { turn: { bets: 'a', raises: '', maxBets: 1 }, river: { bets: '50', raises: '', maxBets: 1 } } },
};
const spec = (game, extra = {}, seed = 7) => E.MultiwayGame({ privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128, ...GAMES[game], ...extra, privateSeed: seed }).nativeSpec();
const writeSpec = (dir, name, s) => { const f = path.join(dir, name + '.json'); fs.writeFileSync(f, JSON.stringify(s)); return f; };

// ---------------------------------------------------------------- reference suite
test('4.7 independent reference suite: known values, best responses, ICM, side pots, CFR family, determinism (28 checks)', { skip: !cxx && 'no C++ compiler', timeout: 600000 }, t => {
  const dir = tmp(t), exe = path.join(dir, 'refsuite');
  cp.execFileSync(cxx, ['-std=c++20', '-O2', '-o', exe, path.join(__dirname, '..', 'reference', 'refmain.cpp')]);
  const r = cp.spawnSync(exe, ['selftest'], { encoding: 'utf8' });
  const out = JSON.parse(r.stdout);
  assert.equal(out.failed, 0, out.checks.filter(c => !c.ok).map(c => c.check + ': ' + c.detail).join('\n'));
  assert.ok(out.passed >= 28);
  for (const name of ['kuhn2 analytic equilibrium', 'CFR+, leduc2', 'three-player Malmuth-Harville', 'side pots']) assert.ok(out.checks.some(c => c.ok && c.check.includes(name)), name);
  const u = cp.spawnSync(exe, ['unbiased', '200000'], { encoding: 'utf8' });
  const ub = JSON.parse(u.stdout);
  assert.equal(ub.failed, 0, 'every sampled estimator is consistent with its exact expectation');
  for (const x of ub.results.filter(x => x.estimator === 'es-own-chance-enumeration')) assert.ok(x.varianceRatio < 0.5, x.game + ' own-chance enumeration reduces regret variance');
});

// ---------------------------------------------------------------- engine: default unchanged, new option
test('4.7 default trainer still writes the 4.4-4.6 golden state (300 updates, 4 threads)', { skip, timeout: 300000 }, t => {
  const dir = tmp(t), st = path.join(dir, 'g.state');
  const info = json(cli([spec45, 300, 4, st, 512]));
  assert.equal(sha(st), GOLDEN_300);
  assert.equal(info.trainer.validatedDefault, true); assert.equal(info.trainer.experimental, false); assert.equal(info.trainer.ownHandEnumeration, false);
});
test('4.7 own-hand enumeration: validation, refused combinations, metadata, distinct study identity', { skip, timeout: 300000 }, t => {
  const dir = tmp(t);
  assert.throws(() => E.MultiwayGame({ privateMode: 'sampled', abstraction: 'exact', traversal: 'external', ...GAMES.river3, ownHandEnumeration: 'yes' }).nativeSpec(), /own-hand enumeration/);
  const s = spec('river3', { ownHandEnumeration: true });
  assert.equal(s.ownHandEnumeration, true); assert.notEqual(s.studyId, spec('river3').studyId, 'the trainer option is part of the study identity');
  const info = json(cli([writeSpec(dir, 's', s), 50, 1, path.join(dir, 'a.state'), 64]));
  assert.equal(info.trainer.ownHandEnumeration, true); assert.equal(info.trainer.experimental, true); assert.equal(info.trainer.validatedDefault, false);
  for (const [name, extra] of [['expectation', { terminalExpectation: true }], ['latin', { chanceSampling: 'latin' }]]) {
    const r = cli([writeSpec(dir, name, { ...s, ...extra }), 5, 1, path.join(dir, name + '.state'), 64]);
    assert.equal(r.status, 1, name); assert.match(r.stderr, /Own-hand enumeration/);
  }
  // a checkpoint of the experimental trainer is refused by a default-trainer spec (different study)
  const r = cli([writeSpec(dir, 'def', spec('river3')), 5, 1, path.join(dir, 'x.state'), 64, path.join(dir, 'a.state')]);
  assert.equal(r.status, 1); assert.match(r.stderr, /different study/);
});
test('4.7 own-hand enumeration: deterministic continuation 150+150 = 300 and thread independence', { skip, timeout: 600000 }, t => {
  const dir = tmp(t);
  for (const game of ['river3', 'bubble4']) {
    const f = writeSpec(dir, game, spec(game, { ownHandEnumeration: true, terminalBaseline: true }));
    const a = path.join(dir, game + 'a'), b = path.join(dir, game + 'b'), c = path.join(dir, game + 'c'), d = path.join(dir, game + 'd');
    json(cli([f, 150, 4, a, 256])); json(cli([f, 150, 4, b, 256, a])); json(cli([f, 300, 4, c, 256])); json(cli([f, 300, 1, d, 256]));
    assert.equal(sha(b), sha(c), game + ': resumed equals uninterrupted');
    assert.equal(sha(c), sha(d), game + ': 1 and 4 threads write identical bytes');
  }
});
test('4.7 own-hand enumeration with one hand per seat reproduces the default trainer', { skip, timeout: 300000 }, t => {
  const dir = tmp(t), q = path.join(dir, 'q.json'); fs.writeFileSync(q, JSON.stringify({ method: 'exact' }));
  const vals = {};
  for (const [k, extra] of [['default', {}], ['own', { ownHandEnumeration: true }]]) {
    const f = writeSpec(dir, k, spec('final8', extra)); json(cli([f, 400, 2, path.join(dir, k), 256]));
    vals[k] = json(cli(['--gain', f, path.join(dir, k), q])).seats.map(s => s.gain);
  }
  vals.default.forEach((g, i) => assert.ok(Math.abs(g - vals.own[i]) <= 1e-9 * Math.max(1, Math.abs(g)), 'seat ' + i));
});
test('4.7 engine unbiasedness: own-hand enumeration matches the default estimator in expectation', { skip, timeout: 900000 }, t => {
  const dir = tmp(t), out = path.join(dir, 'u.json');
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'unbiased47.js'), tool(), out, '400'], { encoding: 'utf8', timeout: 900000 });
  const rep = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.ok(rep.passed);
  const own = rep.candidates.find(c => c.estimator === 'ownHandEnumeration');
  assert.ok(own.regretVarianceRatioToDefault < 0.5, 'variance reduced: ' + own.regretVarianceRatioToDefault);
});

// ---------------------------------------------------------------- verify / compare / monitor
test('4.7 mwcli --verify: exact, restricted and sampled classes, positions, Mode D local deviations', { skip, timeout: 300000 }, t => {
  const dir = tmp(t), f = writeSpec(dir, 'r3', spec('river3')), st = path.join(dir, 'r3.state');
  json(cli([f, 3000, 2, st, 256]));
  const q = path.join(dir, 'q.json'); fs.writeFileSync(q, JSON.stringify({ method: 'exact' }));
  const g = json(cli(['--gain', f, st, q]));
  const v = json(cli(['--verify', f, st, 'node=', 'board=']));
  assert.equal(v.mode, 'exactBestResponse'); assert.equal(v.methodUsed, 'exact');
  assert.equal(v.aggregate.nashConv, g.seats.reduce((a, s) => a + s.gain, 0));
  assert.match(v.aggregate.exploitabilityNote, /not exploitability/);
  assert.equal(v.seats.length, 3); for (const s of v.seats) { assert.ok(s.gain >= 0); assert.ok(s.coverage.policyLookups > 0); assert.match(s.relativeGain.basis, /starting pot/); }
  assert.equal(v.localDeviations.status, 200); assert.ok(v.localDeviations.result.actions.length >= 2);
  const r = json(cli(['--verify', f, st, 'method=restricted'])); assert.match(r.resultClass, /LOWER BOUND/); assert.ok('nashConvLowerBound' in r.aggregate);
  const s = json(cli(['--verify', f, st, 'method=sampled', 'samples=2000', 'seed=5']));
  assert.match(s.resultClass, /ESTIMATE of a LOWER BOUND/); assert.ok(s.seats.every(x => x.simultaneousCi && x.simultaneousCi[1] - x.simultaneousCi[0] >= x.ci95[1] - x.ci95[0] - 1e-12), 'simultaneous intervals are at least as wide as unadjusted ones');
  const f8 = writeSpec(dir, 'f8', spec('final8')); json(cli([f8, 50, 2, path.join(dir, 'f8.state'), 256]));
  const p = json(cli(['--verify', f8, path.join(dir, 'f8.state'), 'method=exact']));
  assert.deepEqual(p.seats.map(x => x.position), ['UTG', 'UTG+1', 'MP', 'HJ', 'CO', 'BTN', 'SB', 'BB']); assert.equal(p.utilityModel, 'icm'); assert.match(p.seats[0].relativeGain.basis, /ICM equity/);
  assert.equal(cli(['--verify', f, st, 'bogus=1']).status, 2);
});
test('4.7 mwcli --compare: identity, distances, exact gain differences, incompatible games refused', { skip, timeout: 300000 }, t => {
  const dir = tmp(t), f = writeSpec(dir, 'r3', spec('river3')), a = path.join(dir, 'a'), b = path.join(dir, 'b');
  json(cli([f, 500, 2, a, 256])); json(cli([f, 4000, 2, b, 256]));
  const same = json(cli(['--compare', f, a, a]));
  assert.equal(same.identicalStrategies, true); assert.equal(same.strategyDistance.weightedOverCommonRows, 0); assert.equal(same.overlap.jaccard, 1);
  assert.ok(same.gains.differences.every(d => d.gainB_minus_gainA === 0));
  const csv = path.join(dir, 'c.csv'), c = json(cli(['--compare', f, a, b, 'csv=' + csv]));
  assert.equal(c.compatible, true); assert.equal(c.identicalStrategies, false); assert.ok(c.strategyDistance.weightedOverCommonRows > 0);
  assert.equal(c.A.updates, 500); assert.equal(c.B.updates, 4000); assert.equal(c.gains.differences.length, 3);
  assert.match(fs.readFileSync(csv, 'utf8'), /^seat,position,gainA/);
  const other = spec('river3', {}, 99), fo = writeSpec(dir, 'other', other), o = path.join(dir, 'o'); json(cli([fo, 300, 1, o, 256]));
  const seeds = json(cli(['--compare', f, a, o, 'specB=' + fo, 'gains=none']));
  assert.equal(seeds.compatible, true, 'different seeds solve the same game'); assert.ok(seeds.differingTrainerSettings.some(x => /seed/.test(x)));
  const own = writeSpec(dir, 'own', spec('river3', { ownHandEnumeration: true })), ow = path.join(dir, 'ow'); json(cli([own, 300, 1, ow, 256]));
  const alg = json(cli(['--compare', f, a, ow, 'specB=' + own, 'gains=exact']));
  assert.equal(alg.compatible, true); assert.ok(alg.differingTrainerSettings.includes('ownHandEnumeration'));
  const f8 = writeSpec(dir, 'f8', spec('final8')); json(cli([f8, 20, 1, path.join(dir, 'f8.state'), 256]));
  const bad = cli(['--compare', f, a, path.join(dir, 'f8.state'), 'specB=' + f8]);
  assert.equal(bad.status, 3); assert.equal(JSON.parse(bad.stdout).compatible, false);
  const wrong = cli(['--compare', f, a, path.join(dir, 'f8.state')]); assert.equal(wrong.status, 3, 'a checkpoint of another study is refused');
});
test('4.7 mwcli --monitor: analytics schema, adaptive schedule, continuation identity, stopping rules', { skip, timeout: 600000 }, t => {
  const dir = tmp(t), f = writeSpec(dir, 'r3', spec('river3')), mon = path.join(dir, 'mon');
  const out = json(cli(['--monitor', f, mon, 'updates=2000', 'first=50', 'threads=2', 'memory=256']));
  const doc = JSON.parse(fs.readFileSync(path.join(mon, 'analytics.json'), 'utf8'));
  assert.equal(doc.schema, 'eightmax-analytics/1'); assert.equal(doc.status, 'finished'); assert.equal(doc.stop.reason, 'maximum updates'); assert.equal(out.evaluations, doc.evaluations.length);
  const ups = doc.evaluations.map(r => r.updates); assert.ok(ups.every((u, i) => !i || u > ups[i - 1])); assert.equal(ups[ups.length - 1], 2000);
  for (const r of doc.evaluations) { assert.equal(r.evaluation.mode, 'exactBestResponse'); assert.ok(r.evaluation.nashConv >= 0); assert.equal(r.evaluation.seats.length, 3); assert.ok(r.peakRssMiB > 0); assert.equal(r.coverage.storedRows, r.rows); }
  assert.equal(doc.evaluations[0].strategyChange, null); assert.ok(doc.evaluations[1].strategyChange.weightedTv > 0);
  const plain = path.join(dir, 'plain'); json(cli([f, 2000, 1, plain, 256]));
  assert.equal(sha(plain), sha(path.join(mon, 'checkpoint-00002000.state')), 'monitoring (with evaluations) ends in the state of uninterrupted training');
  assert.equal(fs.readdirSync(mon).filter(x => x.endsWith('.state')).length, 1, 'keep=last keeps only the newest checkpoint');
  const csv = fs.readFileSync(path.join(mon, 'analytics.csv'), 'utf8').trim().split('\n'); assert.equal(csv.length, doc.evaluations.length + 1); assert.match(csv[0], /gain_2,gainLow_2,gainHigh_2$/);
  // resume from the monitor checkpoint continues identically
  const mon2 = path.join(dir, 'mon2'); json(cli(['--monitor', f, mon2, 'updates=3000', 'first=2500', 'eval=none', 'resume=' + path.join(mon, 'checkpoint-00002000.state')]));
  const p3 = path.join(dir, 'p3'); json(cli([f, 3000, 1, p3, 256])); assert.equal(sha(p3), sha(path.join(mon2, 'checkpoint-00003000.state')));
  // exact quality target: certified stop inside the abstraction
  const mon3 = path.join(dir, 'mon3'); json(cli(['--monitor', f, mon3, 'updates=100000', 'first=100', 'target=10']));
  const d3 = JSON.parse(fs.readFileSync(path.join(mon3, 'analytics.json'), 'utf8')); assert.equal(d3.stop.reason, 'quality target'); assert.equal(d3.stop.targetCertified, true); assert.equal(d3.evaluations.length, 1);
  // sampled target is never "certified"
  const mon4 = path.join(dir, 'mon4'); json(cli(['--monitor', f, mon4, 'updates=400', 'first=100', 'eval=sampled', 'samples=500', 'target=100']));
  const d4 = JSON.parse(fs.readFileSync(path.join(mon4, 'analytics.json'), 'utf8')); assert.equal(d4.stop.reason, 'quality target (sampled)'); assert.equal(d4.stop.targetCertified, false); assert.match(d4.stop.detail, /does not verify equilibrium/);
  // elapsed-time stop keeps only committed updates
  const mon5 = path.join(dir, 'mon5'); json(cli(['--monitor', f, mon5, 'updates=10000000', 'first=10000000', 'seconds=0.3', 'eval=none']));
  const d5 = JSON.parse(fs.readFileSync(path.join(mon5, 'analytics.json'), 'utf8')); assert.equal(d5.stop.reason, 'maximum elapsed training time');
  const u5 = d5.evaluations[0].updates, p5 = path.join(dir, 'p5'); json(cli([f, u5, 1, p5, 256])); assert.equal(sha(p5), sha(path.join(mon5, d5.evaluations[0].checkpoint.file)));
});
test('4.7 JavaScript analytics agree with the native analytics (parse, strategy hash, distance, game hash, %.17g)', { skip, timeout: 300000 }, async t => {
  const A = E.analytics, dir = tmp(t), s = spec('river3'), f = writeSpec(dir, 'r3', s), a = path.join(dir, 'a'), b = path.join(dir, 'b');
  json(cli([f, 400, 1, a, 256])); json(cli([f, 1500, 1, b, 256]));
  const v = json(cli(['--verify', f, a, 'method=exact'])), c = json(cli(['--compare', f, a, b, 'gains=none']));
  const pa = A.parseEMMW4(fs.readFileSync(a)), pb = A.parseEMMW4(fs.readFileSync(b));
  assert.ok(pa.ok && pb.ok); assert.equal(pa.rows.length, v.checkpoint.rows); assert.equal(pa.iterations, 400);
  assert.equal(await A.strategyHash(pa), v.checkpoint.strategyHash);
  const d = A.distance(pa, pb, 3);
  assert.equal(d.weightedTv, c.strategyDistance.weightedOverCommonRows); assert.equal(d.meanTv, c.strategyDistance.meanOverCommonRows); assert.equal(d.common, c.overlap.common);
  assert.equal(await A.gameHash(s), v.game.gameHash);
  for (const x of [0.1, 1 / 3, 20, 1e-7, 123456789012345678, 2.5e21, -0.25, 1e-5, 0.0001]) {
    const r = cp.spawnSync('python3', ['-c', `print('%.17g' % ${x})`], { encoding: 'utf8' }); if (r.status === 0) assert.equal(A.g17(x), r.stdout.trim(), String(x));
  }
  assert.equal(A.parseEMMW4(fs.readFileSync(a).subarray(0, 100)).ok, false);
  const doc = JSON.parse(JSON.stringify({ schema: 'eightmax-analytics/1', game: { players: 3 }, evaluations: [{ index: 0, updates: 1, trainingDeals: 1, evaluation: { mode: 'exactBestResponse', nashConv: 0.5, seats: [{ gain: 0.1 }, { gain: 0.2 }, { gain: 0.2 }] } }] }));
  assert.match(A.toCSV(A.validateDoc(doc)).split('\n')[1], /^0,1,1,/);
  assert.throws(() => A.validateDoc({ schema: 'x' }), /analytics file/);
  const html = A.chartsHTML([doc]); assert.equal((html.match(/<figure/g) || []).length, 7);
});
test('4.7 dashboard live monitor against the native host: real measurements, continuation identity, stop rules', { skip: (skip || hostSkip) || false, timeout: 600000 }, async t => {
  const dir = tmp(t), s = spec('river3');
  await withHost(home(t), {}, async (api0, url) => {
    const napi = async (p, body) => { const r = await fetch(url + p, body === undefined ? {} : { method: 'POST', headers: { 'X-EightMax': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => null); if (!r.ok) throw Error((j && j.error) || String(r.status)); return j; };
    const api = { get: p => napi(p), post: (p, b) => napi(p, b), bytes: async p => (await fetch(url + p)).arrayBuffer() };
    const updates = []; const m = new E.Monitor(api, { threads: 2, tableMiB: 128, first: 100, maxUpdates: 1500, evaluation: 'exact', pollMs: 20, share: 1 }, d => updates.push(d.evaluations.length));
    const doc = await m.run(s);
    assert.equal(doc.status, 'finished'); assert.equal(doc.stop.reason, 'maximum updates'); assert.ok(doc.evaluations.length >= 2);
    const ups = doc.evaluations.map(r => r.updates); assert.equal(ups[0], 100); assert.ok(ups.every((u, i) => !i || u > ups[i - 1]));
    assert.equal(doc.trainer.validatedDefault, true);
    for (const r of doc.evaluations) { assert.equal(r.evaluation.mode, 'exactBestResponse'); assert.ok(r.rssMiB > 0 && r.peakRssMiB >= r.rssMiB - 1); assert.ok(r.dealsPerSecond > 0); assert.ok(r.checkpoint.strategyHash.length === 64); }
    const last = doc.evaluations[doc.evaluations.length - 1]; assert.equal(last.updates, 1500);
    const f = writeSpec(dir, 's', s), p = path.join(dir, 'p'); json(cli([f, 1500, 1, p, 128]));
    assert.equal(sha(p), last.checkpoint.sha256, 'the host state after monitored training equals uninterrupted mwcli training');
    const v = json(cli(['--verify', f, p, 'method=exact'])); assert.equal(v.aggregate.nashConv, last.evaluation.nashConv, 'dashboard and mwcli report the same exact NashConv');
    assert.ok(updates.length > doc.evaluations.length, 'the page is updated while training runs');
    // user cancellation
    const m2 = new E.Monitor(api, { threads: 1, tableMiB: 128, first: 5000000, maxUpdates: 5000000, evaluation: 'none', pollMs: 20 }, () => {});
    setTimeout(() => m2.stop(), 300); const d2 = await m2.run(spec('river3', {}, 8));
    assert.equal(d2.stop.reason, 'user cancellation'); assert.ok(d2.evaluations[0].updates > 0 && d2.evaluations[0].updates < 5000000);
    const csv = E.analytics.toCSV(doc); assert.equal(csv.trim().split('\n').length, doc.evaluations.length + 1);
  });
});
test('4.7 independent best-response cross-check (Python, no engine code): heads-up and three-player river agree to 1e-9', { skip: skip || (cp.spawnSync('python3', ['--version']).status !== 0 && 'no python3'), timeout: 600000 }, t => {
  const dir = tmp(t);
  const hu = { board: 'Ks8d5h2c2s', common: 10, stacks: [20, 20], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd:0.5,KcJc,5d5c,8h7h:0.25,AdQd,JdTd'], streets: { river: { bets: '50,a', raises: 'a', maxBets: 2 } } };
  for (const [name, cfg, updates] of [['hu', hu, 3000], ['river3', GAMES.river3, 4000], ['hu-own', { ...hu, ownHandEnumeration: true, terminalBaseline: true }, 2000]]) {
    const f = writeSpec(dir, name, E.MultiwayGame({ privateMode: 'sampled', abstraction: 'exact', traversal: 'external', ...cfg, privateSeed: 3 }).nativeSpec()), st = path.join(dir, name + '.state');
    json(cli([f, updates, 1, st, 256]));
    const r = cp.spawnSync('python3', [path.join(__dirname, '..', 'tools', 'independent_br47.py'), tool(), f, st], { encoding: 'utf8', timeout: 600000 });
    const rep = JSON.parse(r.stdout);
    assert.equal(rep.agree, true, name + ': ' + JSON.stringify(rep.seats)); assert.equal(rep.storedRowsUsed, rep.storedRows, name + ': every stored row was used');
    assert.ok(rep.seats.every(s => s.independentGain > 0), name + ': training is not converged, so the check is not trivial');
  }
});
test('4.7 compressed checkpoints (EMZ1): lossless round trip, resume = uninterrupted, corruption and truncation refused', { skip, timeout: 600000 }, t => {
  const dir = tmp(t), a = path.join(dir, 'a.state'), z = path.join(dir, 'a.emz'), back = path.join(dir, 'back.state');
  json(cli([spec45, 150, 4, a, 512]));
  const c = json(cli(['--compress', a, z])); assert.ok(c.ratio < 0.8, 'compression ratio ' + c.ratio); assert.equal(c.stateSha256, sha(a));
  json(cli(['--decompress', z, back])); assert.equal(sha(back), sha(a), 'decompression restores every byte');
  const b = path.join(dir, 'b.state'); json(cli([spec45, 150, 4, b, 512, z])); assert.equal(sha(b), GOLDEN_300, '150 + 150 resumed from a compressed checkpoint = the golden 300-update state');
  const bytes = fs.readFileSync(z);
  const cases = { 'flipped byte': Buffer.from(bytes).fill(bytes[bytes.length >> 1] ^ 0x10, bytes.length >> 1, (bytes.length >> 1) + 1), truncated: bytes.subarray(0, bytes.length - 20), 'no end block': bytes.subarray(0, bytes.length - 56), 'header only': bytes.subarray(0, 16) };
  for (const [name, buf] of Object.entries(cases)) {
    const f = path.join(dir, name.replace(/ /g, '_') + '.emz'), out = path.join(dir, 'x.state'); fs.writeFileSync(f, buf);
    const r = cli(['--decompress', f, out]); assert.equal(r.status, 1, name); assert.ok(!fs.existsSync(out), name + ': nothing written');
    const r2 = cli([spec45, 5, 1, out, 512, f]); assert.equal(r2.status, 3, name + ': training refuses it'); assert.ok(!fs.existsSync(out));
  }
  assert.equal(cli(['--compress', path.join(dir, 'missing.state'), z]).status, 3);
  // grouped (rowKeys) and DCFR (rowSync) layouts round-trip too
  for (const [name, extra] of [['grouped', { abstraction: 'compact' }], ['dcfr', { weighting: 'dcfr' }]]) {
    const s = E.MultiwayGame({ privateMode: 'sampled', traversal: 'external', evaluationDeals: 128, ...GAMES.river3, abstraction: 'exact', ...extra, privateSeed: 4 }).nativeSpec();
    const f = writeSpec(dir, name, s), st = path.join(dir, name + '.state'), ez = st + '.emz', rt = st + '.rt'; json(cli([f, 300, 1, st, 256]));
    json(cli(['--compress', st, ez])); json(cli(['--decompress', ez, rt])); assert.equal(sha(rt), sha(st), name);
  }
});
