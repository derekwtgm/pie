'use strict';
// EightMax 5.11 regression tests.
//   5.11 adds counter-based 64-bit TRAINING streams ("trainingStreams":"philox64" in a protocol-4 spec; native/streams511.hpp)
//   and removes the 10,000,000-update limit for states trained with them. A spec without the key, and every state of
//   5.10 or earlier, keeps the 32-bit streams and that limit. Tested here:
//     - mwcli --selftest511: every check, its exit status, sections, and that no check that needs a fixture passes
//       without it;
//     - the generator and the address rule against an independent implementation in Python integers
//       (tools/independent_streams511.py);
//     - the 5.10 streams: untouched (the spec without the key, the explicit "5.10"), and how they coincide
//       (tools/streams511_overlap.c: arithmetic, recorded counts);
//     - philox64 on the reference games of tools/games510.js: reproducible, independent of the thread count, stopped
//       and continued byte for byte; the header of its states; the unchanged 5.10 program refuses them;
//     - the limits and the refusals of the command-line trainer and of studies; the study records its streams;
//     - the experiment runner (a dry run), the Windows validation script of 5.11, its launchers and reference files.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const build = require('./native_build');
const games = require('../tools/games510.js');
const src = path.resolve(__dirname, '..'), root = path.resolve(src, '..'), studies = path.join(src, 'studies');
const cli = () => process.env.EM_TEST_MWCLI || build.cli().cli;
const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'em511-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const run = (args, env = {}) => cp.spawnSync(cli(), args.map(String), { encoding: 'utf8', timeout: 1800000, maxBuffer: 256 << 20, env: { ...process.env, ...env } });
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const WIDE = { trainingStreams: 'philox64' }, BATCH = { batchDeals: 64, actionStreams: 'deal' }, ALGORITHM = 'streams-5.11-philox4x64-v1', MAX = 140737488355327;
const specFile = (dir, key, seed = 1, extra = {}, tag = '') => { const f = path.join(dir, key + tag + '.spec.json'); fs.writeFileSync(f, JSON.stringify({ ...games.spec(key, seed), ...extra })); return f; };
const train = (spec, updates, state, threads = 1, input = null, env = {}, mem = 512) => run([spec, updates, threads, state, mem, ...(input ? [input] : [])], env);
const trainOk = (...a) => { const r = train(...a); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };
const header = f => { const b = fs.readFileSync(f); assert.equal(b.subarray(0, 5).toString('latin1'), 'EMMW4'); return JSON.parse(b.subarray(12, 12 + b.readUInt32LE(8)).toString('utf8')); };
const python = () => ['python3', 'python'].find(p => cp.spawnSync(p, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)']).status === 0);
const compilerSkip = process.platform === 'win32' && !process.env.EM_TEST_CC ? 'needs a C compiler (set EM_TEST_CC)' : false;
const IDS = ['streams G1', 'streams G2', 'streams G3', 'streams A1', 'streams A2', 'streams N1', 'streams L1', 'streams U1', 'streams U2',
  'training D1', 'training W1', 'training W2', 'training W3', 'training W4', 'training W5', 'training W6', 'training W7', 'training W8',
  'checkpoint C1', 'checkpoint C2', 'checkpoint C3', 'limits L1', 'limits L2', 'limits L3', 'limits L4', 'limits L5'];

// ---------------- mwcli --selftest511 ----------------
test('5.11 self-test: every check passes, the report lists each of them once, and the exit status says the same', { timeout: 1800000 }, t => {
  const d = tmp(t), r = run(['--selftest511', studies, d, 'all']);
  assert.equal(r.status, 0, r.stdout + r.stderr.slice(-3000));
  const doc = JSON.parse(fs.readFileSync(path.join(d, 'selftest511.json'), 'utf8')), line = JSON.parse(r.stdout);
  assert.equal(doc.tool, 'mwcli selftest511'); assert.ok([fs.readFileSync(path.join(src, 'VERSION'), 'utf8').trim(), 'development'].includes(doc.version), doc.version);
  assert.equal(doc.failed, 0); assert.equal(doc.untested, 0); assert.equal(doc.passed, IDS.length);
  assert.deepEqual(doc.checks.map(c => c.section + ' ' + c.id), IDS); assert.ok(doc.checks.every(c => c.status === 'passed' && c.name.length > 20 && c.detail.length > 5));
  assert.equal(line.passed, doc.passed); assert.equal(line.failed, 0); assert.ok([ALGORITHM, '5.10 (32-bit)'].includes(doc.studyDefaultStreams));
  // the work folder holds the report and nothing else: every state and spec the checks wrote was removed
  assert.deepEqual(fs.readdirSync(d), ['selftest511.json']);
  // the audit really recorded: more than 200,000 counters, none twice
  const u1 = doc.checks.find(c => c.id === 'U1'); assert.match(u1.detail, /^7 of 7 configurations, (\d+) counters in all/); assert.ok(+/(\d+) counters in all/.exec(u1.detail)[1] > 200000, u1.detail); assert.ok(!/NOT AS REQUIRED/.test(u1.detail));
  // the limit was really crossed
  assert.match(doc.checks.find(c => c.id === 'L2' && c.section === 'limits').detail, /updates in the header 10000200; continued = uninterrupted; state [0-9a-f]{16} = recorded/);
  assert.match(doc.checks.find(c => c.id === 'L3').detail, /updates in the header 4294970303/);
});
test('5.11 self-test: sections can be run alone; a wrong section or a missing folder is a usage error; no check that needs a fixture passes without it', { timeout: 900000 }, t => {
  const d = tmp(t);
  for (const [section, n] of [['streams', 9], ['checkpoint', 3], ['limits', 5]]) { const w = path.join(d, section), r = run(['--selftest511', studies, w, section]); assert.equal(r.status, 0, r.stderr.slice(-2000)); const doc = JSON.parse(fs.readFileSync(path.join(w, 'selftest511.json'), 'utf8')); assert.equal(doc.section, section); assert.equal(doc.passed, n); assert.ok(doc.checks.every(c => c.section === section)); }
  assert.equal(run(['--selftest511', studies, d, 'everything']).status, 2); assert.equal(run(['--selftest511', path.join(d, 'no-such-folder'), d, 'all']).status, 2); assert.equal(run(['--selftest511']).status, 2);
  const empty = path.join(d, 'empty'); fs.mkdirSync(empty); const r = run(['--selftest511', empty, path.join(d, 'w'), 'all']);
  assert.equal(r.status, 1); const doc = JSON.parse(fs.readFileSync(path.join(d, 'w', 'selftest511.json'), 'utf8'));
  // the seven checks of the generator need no fixture; nothing else may pass
  assert.deepEqual(doc.checks.filter(c => c.status === 'passed').map(c => c.id), ['G1', 'G2', 'G3', 'A1', 'A2', 'N1', 'L1']); assert.ok(doc.untested + doc.failed >= 15);
});

// ---------------- the generator ----------------
test('5.11 streams: an independent implementation in Python integers computes the numbers the program prints (tools/independent_streams511.py)', { timeout: 600000 }, t => {
  const py = python(); if (!py) { t.skip('needs Python 3.8 or newer'); return; }
  const r = cp.spawnSync(py, [path.join(src, 'tools/independent_streams511.py'), 'selfcheck', cli()], { encoding: 'utf8', timeout: 600000 }); assert.equal(r.status, 0, r.stdout.slice(0, 2000) + r.stderr.slice(-1000));
  const doc = JSON.parse(r.stdout); assert.equal(doc.allPassed, true); assert.deepEqual(doc.checks.map(c => c.id), ['K', 'B', 'S']); assert.match(doc.checks[2].detail, /^11100 numbers compared, 0 addresses differ/);
  // a different address gives other numbers, and the tool notices a wrong one (it is not vacuous)
  const a = JSON.parse(run(['--streams511', '1f', 0, 1, 0, 0, 8]).stdout), b = JSON.parse(run(['--streams511', '1f', 0, 2, 0, 0, 8]).stdout), c = JSON.parse(run(['--streams511', '1f', 0, 1, 1, 0, 8]).stdout), e = JSON.parse(run(['--streams511', '1f', 1, 1, 0, 0, 8]).stdout);
  for (const x of [b, c, e]) assert.ok(x.unitBits.every((v, i) => v !== a.unitBits[i]), 'another purpose, update or key domain is another stream');
  const mine = JSON.parse(cp.spawnSync(py, [path.join(src, 'tools/independent_streams511.py'), 'numbers', '1f', '0', '1', '0', '0', '8'], { encoding: 'utf8' }).stdout); assert.deepEqual(mine.unitBits, a.unitBits);
  assert.ok(a.unit.every(v => v >= 0 && v < 1)); assert.equal(a.method, ALGORITHM); assert.equal(a.key1, '454d35313174726e');
  for (const bad of [['--streams511'], ['--streams511', 'xyz', 0, 1, 0, 0, 8], ['--streams511', '1', 9, 1, 0, 0, 8], ['--streams511', '1', 0, 4, 0, 0, 8], ['--streams511', '1', 0, 1, 0, 64, 8], ['--streams511', '1', 0, 1, MAX + 1, 0, 8], ['--streams511', '12345678901234567', 0, 1, 0, 0, 8]]) assert.equal(run(bad).status, 2, bad.join(' '));
});
test('5.11 streams of 5.10: the tool that counts their coincidences reproduces the recorded counts (tools/streams511_overlap.c; arithmetic only)', { skip: compilerSkip, timeout: 900000 }, t => {
  const d = tmp(t), exe = path.join(d, 'overlap' + (process.platform === 'win32' ? '.exe' : ''));
  try { cp.execFileSync(process.env.EM_TEST_CC || 'gcc', ['-O2', path.join(src, 'tools/streams511_overlap.c'), '-o', exe], { stdio: 'ignore' }); } catch (e) { t.skip('no C compiler'); return; }
  const r = cp.spawnSync(exe, ['101'], { encoding: 'utf8', timeout: 900000, maxBuffer: 16 << 20 }); assert.equal(r.status, 0, r.stderr); const doc = JSON.parse(r.stdout);
  assert.equal(doc.actionSeed, (101 ^ 0x7138ab94) >>> 0); assert.equal(doc.dealStreams.length, 5);
  // seed 101, frozen batches of 64: streams that start in the state another stream started in, and streams that start fewer than 32 steps after another
  assert.deepEqual(doc.dealStreams.map(x => [x.updates, x.identicalToAnEarlierStream]), [[1000, 0], [10000, 34], [100000, 3328], [1000000, 412458], [10000000, 43880754]]);
  assert.deepEqual(doc.dealStreams.slice(0, 4).map(x => x.fewerThan32), [25, 3021, 294712, 23953905]);
  assert.equal(doc.sharedStreams.stepsFromDealStartToActionStart, 195119580); assert.deepEqual(doc.smallestLagOverSeeds0To99999, { seed: 528, steps: 11001124 });
  // the same arithmetic in JavaScript for the smallest case: the start states of 64,000 streams, none identical
  const seen = new Set(); for (let t2 = 0; t2 < 1000; t2++) for (let k = 0; k < 64; k++) seen.add((doc.actionSeed ^ Math.imul(t2 + 1, 0x9e3779b1) ^ Math.imul(k + 1, 0x85ebca6b)) >>> 0); assert.equal(seen.size, 64000);
});

// ---------------- the two kinds of streams as a user trains ----------------
test('5.11 the 5.10 streams are untouched: a spec without the key and a spec that says "5.10" write the same state, with the 5.10 header and the 5.10 limit', { timeout: 600000 }, t => {
  const d = tmp(t);
  for (const [key, extra, updates, threads] of [['rg-turn4', {}, 4000, 1], ['rg-flop6c', BATCH, 60, 3]]) {
    const a = specFile(d, key, 7, extra, '-a'), b = specFile(d, key, 7, { ...extra, trainingStreams: '5.10' }, '-b'), sa = path.join(d, 'a.state'), sb = path.join(d, 'b.state');
    const ia = trainOk(a, updates, sa, threads, null, { EIGHTMAX_THREAD_CHOICE: 'fixed' }), ib = trainOk(b, updates, sb, threads, null, { EIGHTMAX_THREAD_CHOICE: 'fixed' });
    assert.equal(sha(sa), sha(sb), key); assert.equal(ia.trainingStreams, undefined); assert.equal(ib.maxUpdates, undefined); assert.equal(ia.trainer.trainingStreams, undefined);
    const h = header(sa); assert.ok(Number.isInteger(h.rng) && Number.isInteger(h.actionRng)); assert.equal(h.trainingStreams, undefined); assert.equal(h.trainingSeed, undefined);
    // the archived 5.10 program writes that state too (Linux: the binary is in the release tree)
    const old = path.join(root, 'validation/5.10/linux-bin/mwcli');
    if (process.platform === 'linux' && fs.existsSync(old)) { const so = path.join(d, 'old.state'), copy = path.join(d, 'mwcli510'); fs.copyFileSync(old, copy); fs.chmodSync(copy, 0o755);
      const r = cp.spawnSync(copy, [a, updates, threads, so, 512].map(String), { encoding: 'utf8', env: { ...process.env, EIGHTMAX_THREAD_CHOICE: 'fixed' } }); assert.equal(r.status, 0, r.stderr); assert.equal(sha(so), sha(sa), key + ': the state of the 5.10 program'); }
  }
});
test('5.11 philox64: reproducible, the same state for 1, 2 and 3 threads and with the 5.6 batch update, stopped and continued byte for byte; the header names the streams and carries no generator state', { timeout: 900000 }, t => {
  const d = tmp(t);
  for (const [key, extra] of [['rg-turn4', {}], ['rg-icm3-river', {}], ['rg-flop6c', {}], ['rg-turn3', { estimator: 'rbes' }]]) {
    const one = specFile(d, key, 11, { ...WIDE, ...extra }), batch = specFile(d, key, 11, { ...WIDE, ...BATCH, ...extra }, '-b'), s = n => path.join(d, key + n + '.state');
    const i1 = trainOk(one, 3000, s(1)); trainOk(one, 3000, s(2)); assert.equal(sha(s(1)), sha(s(2)), key + ': repeat');
    trainOk(one, 1000, s(3)); trainOk(one, 2000, s(4), 1, s(3)); assert.equal(sha(s(4)), sha(s(1)), key + ': continued');
    const fixed = { EIGHTMAX_THREAD_CHOICE: 'fixed' }; trainOk(batch, 60, s(5), 1, null, fixed); trainOk(batch, 60, s(6), 2, null, fixed); trainOk(batch, 60, s(7), 3, null, fixed); trainOk(batch, 60, s(8), 3, null, { EIGHTMAX_LEGACY_BATCH: '1' });
    assert.equal(sha(s(5)), sha(s(6)), key + ': 2 threads'); assert.equal(sha(s(5)), sha(s(7)), key + ': 3 threads'); assert.equal(sha(s(5)), sha(s(8)), key + ': 5.6 batch update');
    trainOk(batch, 20, s(9), 2, null, fixed); trainOk(batch, 40, s(10), 3, s(9), fixed); assert.equal(sha(s(10)), sha(s(5)), key + ': batch continued on another thread count');
    assert.equal(i1.trainingStreams, ALGORITHM); assert.equal(i1.trainer.trainingStreams, ALGORITHM); assert.equal(i1.maxUpdates, MAX); assert.match(i1.trainingSeed, /^[0-9a-f]{16}$/); assert.equal(i1.iterations, 3000);
    const h = header(s(1)); assert.equal(h.trainingStreams, ALGORITHM); assert.equal(h.trainingSeed, i1.trainingSeed); assert.ok(!('rng' in h) && !('actionRng' in h), 'no 32-bit generator state'); assert.equal(h.iterations, 3000);
    assert.equal(h.estimator, extra.estimator ? 'rbes-5.10-v1' : undefined);
    // another seed of the game is another key, and the state of the 5.10 streams is another state
    const other = specFile(d, key, 12, { ...WIDE, ...extra }, '-o'), legacy = specFile(d, key, 11, extra, '-l'); trainOk(other, 3000, s(11)); trainOk(legacy, 3000, s(12));
    assert.notEqual(sha(s(11)), sha(s(1))); assert.notEqual(sha(s(12)), sha(s(1))); assert.notEqual(header(s(12)).studyId, h.studyId);
  }
});
test('5.11 checkpoints: a state continues only under its own streams and seed, in both directions; the unchanged 5.10 program refuses a philox64 state', { timeout: 600000 }, t => {
  const d = tmp(t), wide = specFile(d, 'rg-turn4', 3, WIDE, '-w'), legacy = specFile(d, 'rg-turn4', 3, {}, '-l'), seeded = specFile(d, 'rg-turn4', 3, { ...WIDE, trainingSeed: 'abcdef0123456789' }, '-s');
  const sw = path.join(d, 'w.state'), sl = path.join(d, 'l.state'), ss = path.join(d, 's.state'), out = path.join(d, 'out.state');
  trainOk(wide, 2000, sw); trainOk(legacy, 2000, sl); const is = trainOk(seeded, 2000, ss); assert.equal(is.trainingSeed, 'abcdef0123456789'); assert.equal(header(ss).trainingSeed, 'abcdef0123456789');
  for (const [spec, input, why] of [[wide, sl, /5\.10 training streams/], [legacy, sw, /counter-based training streams/], [seeded, sw, /different training seed/], [wide, ss, /different training seed/]]) {
    const r = train(spec, 10, out, 1, input); assert.equal(r.status, 1); assert.match(r.stderr, /was refused/); assert.match(r.stderr, why); assert.ok(!fs.existsSync(out), 'nothing written');
  }
  // the right pairs continue
  for (const [spec, input] of [[wide, sw], [legacy, sl], [seeded, ss]]) { assert.equal(trainOk(spec, 10, out, 1, input).iterations, 2010); fs.unlinkSync(out); }
  const old = path.join(root, 'validation/5.10/linux-bin/mwcli');
  if (process.platform === 'linux' && fs.existsSync(old)) { const copy = path.join(d, 'mwcli510'); fs.copyFileSync(old, copy); fs.chmodSync(copy, 0o755);
    for (const spec of [legacy, wide]) { const r = cp.spawnSync(copy, [spec, 10, 1, out, 512, sw].map(String), { encoding: 'utf8' }); assert.notEqual(r.status, 0, 'the 5.10 program must not continue a philox64 state'); assert.match(r.stderr, /refused/); assert.ok(!fs.existsSync(out)); } }
});
test('5.11 limits: 10,000,000 updates for the 5.10 streams and for DCFR, 140,737,488,355,327 for philox64; malformed stream settings are refused before anything is trained', { timeout: 600000 }, t => {
  const d = tmp(t), out = path.join(d, 'x.state'), wide = specFile(d, 'hu-river', 1, WIDE, '-w'), legacy = specFile(d, 'hu-river', 1, {}, '-l'), dcfr = specFile(d, 'hu-river', 1, { ...WIDE, weighting: 'dcfr' }, '-d');
  for (const [spec, updates] of [[legacy, 10000001], [dcfr, 10000001], [wide, MAX + 1], [path.join(d, 'none.json'), 10000001]]) { const r = run([spec, updates, 1, out]); assert.equal(r.status, 2, spec + ' ' + r.stderr); assert.match(r.stderr, /0 to 10,000,000/); assert.ok(!fs.existsSync(out)); }
  assert.match(fs.readFileSync(path.join(src, 'native/mw.h'), 'utf8'), /#define MW_MAX_UPDATES 10000000LL\n[^]*#define MW_MAX_UPDATES_WIDE 140737488355327LL/);
  assert.equal(Math.floor((2 ** 53 - 1) / 64), MAX, 'the bound keeps 64 deals per update an exact integer below 2^53');
  // a philox64 state past the limit of the 5.10 streams (the two-hand river game trains about two million deals a second)
  const big = trainOk(wide, 10000064, out); assert.equal(big.iterations, 10000064); assert.equal(big.trainingDeals, 10000064); assert.equal(header(out).iterations, 10000064); fs.unlinkSync(out);
  for (const [extra, why] of [[{ trainingStreams: 'mt19937' }, /Unknown trainingStreams/], [{ trainingStreams: 64 }, /Unknown trainingStreams/], [{ trainingSeed: '1' }, /needs trainingStreams philox64/], [{ ...WIDE, trainingSeed: 'ABC' }, /hexadecimal/], [{ ...WIDE, trainingSeed: '' }, /hexadecimal/],
    [{ ...WIDE, trainingSeed: '11111111111111111' }, /hexadecimal/], [{ ...WIDE, trainingSeed: 5 }, /hexadecimal/], [{ ...WIDE, protocol: 1 }, /./]]) {
    const f = specFile(d, 'hu-river', 1, extra, '-bad'), r = run([f, 10, 1, out]); assert.equal(r.status, 1, JSON.stringify(extra) + r.stderr); assert.match(r.stderr, why); assert.ok(!fs.existsSync(out));
  }
  // a spec that starts after update 0 has no 32-bit generator state to carry
  const s = games.spec('hu-river', 1); assert.ok(s.state.rng > 0);
  const started = path.join(d, 'started.json'); fs.writeFileSync(started, JSON.stringify({ ...s, ...WIDE, state: { ...s.state, iterations: 5, trainingDeals: 5 } })); assert.equal(run([started, 10, 1, out]).status, 1);
  fs.writeFileSync(started, JSON.stringify({ ...s, ...WIDE, state: { iterations: 5, trainingDeals: 5, stateVisits: 0 } })); assert.equal(trainOk(started, 10, out).iterations, 15);
});
test('5.11 studies: the result records the training streams of every variant; the option selects them; the 5.10 limit applies to the 5.10 streams only', { timeout: 900000 }, t => {
  const d = tmp(t), fx = path.join(studies, 'known-akq-river.emfix.json'), out = path.join(d, 'study.json');
  const study = (...opts) => { fs.rmSync(out, { force: true }); const r = run(['--study', fx, out, 'quiet=1', 'seeds=2', 'budgets=2000,8000', 'checkpoint=off', ...opts]); return { r, doc: fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null }; };
  const a = study('trainingStreams=philox64'), b = study('trainingStreams=5.10'), c = study();
  for (const x of [a, b, c]) { assert.equal(x.r.status, 0, x.r.stderr); assert.equal(x.doc.completion.complete, true); }
  assert.equal(a.doc.run.trainingStreams.streams, ALGORITHM); assert.equal(a.doc.run.trainingStreams.chosenByTheStudy, true); assert.equal(b.doc.run.trainingStreams.streams, '5.10 (32-bit)'); assert.equal(c.doc.run.trainingStreams.chosenByTheStudy, false);
  const point = x => x.doc.variants[0].perSeed[0].budgets[0], text = x => JSON.stringify(x.doc);
  assert.ok(text(a).includes('"trainingStreams":"' + ALGORITHM + '"}')); assert.ok(!text(b).includes('"trainingStreams":"' + ALGORITHM + '"}'), 'a 5.10-stream study has no philox64 trainer object');
  // a study that does not choose follows the release default, which the self-test reports
  const st = JSON.parse(run(['--selftest511', studies, path.join(d, 'st'), 'checkpoint']).stdout); assert.equal(st.failed, 0);
  const dflt = JSON.parse(fs.readFileSync(path.join(d, 'st', 'selftest511.json'), 'utf8')).studyDefaultStreams; assert.equal(c.doc.run.trainingStreams.streams, dflt);
  // equal seeds and deals: the same measurements twice (the streams are a function of the seed), and other numbers than the other kind of streams
  const a2 = study('trainingStreams=philox64'), measured = x => ['frequency', 'ev', 'evStdErr', 'quality', 'seatGain', 'rows', 'deals'].map(k => JSON.stringify(point(x)[k])).join('|'); assert.equal(measured(a2), measured(a)); assert.notEqual(measured(a), measured(b));
  assert.equal(run(['--study', fx, out, 'trainingStreams=fast']).status, 2);
  const big = run(['--study', fx, path.join(d, 'big.json'), 'quiet=1', 'seeds=1', 'budgets=10000001', 'trainingStreams=5.10']); assert.equal(big.status, 1); assert.match(big.stderr, /10 million iteration limit/); assert.match(big.stderr, /trainingStreams=philox64/);
  const ok = run(['--study', fx, path.join(d, 'ok.json'), 'quiet=1', 'seeds=1', 'budgets=10000001', 'trainingStreams=philox64', 'timeLimitSeconds=0.2', 'checkpoint=off', 'evaluationSamples=64', 'qualitySamples=64']); assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'ok.json'), 'utf8')).variants[0].perSeed[0].budgets[0].budgetDeals, 10000001);
});

// ---------------- the experiment runner and the Windows validation script ----------------
test('5.11 experiment runner: a dry run of validation/5.11/convergence/convergence511.py writes its plan first, records every cell, finds the 5.10 streams identical to themselves, and resumes', { timeout: 1800000 }, t => {
  const py = python(), runner = path.join(root, 'validation/5.11/convergence/convergence511.py'); if (!py || !fs.existsSync(runner) || process.platform === 'win32') { t.skip('needs Python and the release tree (Linux)'); return; }
  const d = tmp(t), timed = path.join(d, 'timed'), obj = path.join(d, 'json.o'), out = path.join(d, 'out');
  try { cp.execFileSync('gcc', ['-O2', '-c', path.join(src, 'native/json.c'), '-o', obj]); cp.execFileSync('g++', ['-std=c++20', '-O2', '-march=x86-64', '-ffp-contract=off', '-I' + path.join(src, 'native'), path.join(root, 'validation/5.11/convergence/timed511.cpp'), path.join(src, 'native/mw.cpp'), obj, '-lpthread', '-ldl', '-o', timed], { stdio: 'ignore' }); } catch (e) { t.skip('no compiler'); return; }
  const go = extra => cp.spawnSync(py, [runner, 'run', root, cli(), cli(), timed, timed, out, '2', ...extra], { encoding: 'utf8', timeout: 1500000, env: { ...process.env, EM_DRY_RUN: '1' } });
  const r = go([]); assert.equal(r.status, 0, r.stderr.slice(-2000));
  const plan = JSON.parse(fs.readFileSync(path.join(out, 'plan.json'), 'utf8')), sum = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8')), rows = fs.readFileSync(path.join(out, 'raw.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(plan.dryRun, true); assert.equal(plan.margin, 1.1); assert.match(plan.document, /RULE, fixed here before measurement/); assert.ok(fs.statSync(path.join(out, 'plan.json')).mtimeMs <= fs.statSync(path.join(out, 'raw.jsonl')).mtimeMs + 1); assert.equal(sum.errorCount, 0);
  const perUnit = g => 2 * plan.deals.length + 1 + 2 + (plan.classes.ranges.includes(g) ? 2 : 0); assert.equal(rows.length, plan.seeds.length * plan.games.reduce((n, g) => n + perUnit(g), 0));
  assert.equal(sum.identity.identical, sum.identity.compared); assert.equal(sum.identity.compared, plan.games.length * plan.seeds.length); assert.equal(sum.rule.outcome, 'dry run: no outcome'); assert.equal(sum.rule.statisticalConditionsMet, false);
  assert.ok(sum.decisive.equalTime.verdict && sum.decisive.equalDeals.verdict); assert.ok(sum.cells.every(c => c.verdict));
  // both arms were the same program here (the dry run of the tool): the philox64 arm still trains another state than the 5.10 arm
  const cell = (arm, g) => rows.find(q => q.arm === arm && q.game === g && q.kind === 'deals'); assert.notEqual(cell('p511', plan.games[0]).sha, cell('s510', plan.games[0]).sha);
  assert.notEqual(go([]).status, 0, 'an existing output directory is refused');
  const done = go(['--resume']); assert.notEqual(done.status, 0); assert.match(done.stderr, /completed and analysed/);
  // an interrupted run: the last unit is cut off; --resume keeps the complete units and reaches the same equal-deals states
  const lines = fs.readFileSync(path.join(out, 'raw.jsonl'), 'utf8').trim().split('\n'), last = JSON.parse(lines[lines.length - 1]), keep = lines.filter(l => { const q = JSON.parse(l); return !(q.game === last.game && q.seed === last.seed); });
  const partial = lines.filter(l => { const q = JSON.parse(l); return q.game === last.game && q.seed === last.seed; }).slice(0, 3);
  fs.unlinkSync(path.join(out, 'summary.json')); fs.writeFileSync(path.join(out, 'raw.jsonl'), keep.concat(partial).join('\n') + '\n');
  const res = go(['--resume']); assert.equal(res.status, 0, res.stderr.slice(-2000)); const note = JSON.parse(fs.readFileSync(path.join(out, 'resume-1.json'), 'utf8')); assert.equal(note.rowsKept, keep.length); assert.equal(note.rowsBefore, keep.length + 3);
  const rows2 = fs.readFileSync(path.join(out, 'raw.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)), key = q => [q.game, q.seed, q.arm, q.kind, q.budget].join('|'), shas = list => list.filter(q => q.kind === 'deals').map(q => key(q) + '|' + q.sha + '|' + q.nashConv).sort();
  assert.equal(rows2.length, rows.length); assert.deepEqual(shas(rows2), shas(rows)); assert.equal(new Set(rows2.map(key)).size, rows2.length, 'every cell once');
});
test('5.11 Windows validation: the script plans and imports every 5.11 check, the focused mode covers what 5.11 added, the launchers run the self-tests first, the reference files are complete', t => {
  const file = path.join(src, 'tools/validate_windows511.ps1'), ps = fs.readFileSync(file, 'utf8'), version = fs.readFileSync(path.join(src, 'VERSION'), 'utf8').trim();
  assert.equal(version, '5.11'); assert.match(ps, /\$Release = '5\.11'/); assert.match(ps, /tool = 'validate_windows511\.ps1'/); assert.ok(!/[^\x00-\x7f]/.test(ps), 'the script is ASCII');
  for (const s of ["Run-Section 'self-test 5.11'", "Run-Section 'streams 5.11'", "Run-Section 'self-test 5.10'", "Run-Section 'estimator 5.10'", "Run-Section 'self-test 5.9'", "Run-Section 'self-test 5.8'", "Run-Section 'self-test 5.7.1'", "Run-Section 'trained response'", "Run-Section 'golden states'", "Run-Section 'threads'", "Run-Section 'GPU'", "Run-Section 'refused study'",
    "'--selftest511', $studies, $dir, 'all'", "'--selftest510', $studies, $dir, 'all'", "validation\\5.11\\windows\\streams", "validation\\5.10\\windows\\estimator", "'every expected 5.11 check is in the report'", '"trainingStreams":"5.10"}']) assert.ok(ps.includes(s), s);
  for (const id of IDS) assert.ok(ps.includes("'" + id + "'"), 'expected check ' + id);
  const plans = [...ps.matchAll(/^Plan '([^']+)' '([^']+)' '([^']+)'/gm)]; assert.ok(plans.length >= 72, plans.length + ' planned checks');
  for (const [, , , cls] of plans) assert.ok(['gate', 'environment', 'hardware', 'information'].includes(cls));
  for (const name of ['mwcli --selftest511 ran and wrote its report', 'every expected 5.11 check is in the report', 'the 5.11 report agrees with the exit status of mwcli', 'identical philox64 state for every thread count', 'philox64 state equals the Linux build', 'philox64 thread scaling on this PC',
    'philox64: every processing mode writes the same state', 'philox64 processing modes on this PC', 'training throughput with the 5.10 streams and with philox64 on this PC', 'mwcli --selftest510 ran and wrote its report', 'rbes state equals the Linux build', 'every golden state reproduced', 'identical state for every thread count']) {
    assert.equal(plans.filter(p => p[2] === name).length, 1, 'planned once: ' + name); const sec = plans.find(p => p[2] === name)[1];
    assert.ok(ps.includes("Check '" + sec + "' '" + name + "'") || ps.includes("Add-Check '" + sec + "' '" + name + "'"), 'planned but never recorded: ' + name);
  }
  const focus = /\$focusSections = @\(([^)]*)\)/.exec(ps)[1]; for (const s of ["'self-test 5.11'", "'streams 5.11'", "'golden states'", "'threads'", "'integrity'"]) assert.ok(focus.includes(s), 'focused: ' + s);
  // every section of the 5.10 script is still there, in the same order
  const sections = text => [...text.matchAll(/^Run-Section '([^']+)'/gm)].map(m => m[1]), before = sections(fs.readFileSync(path.join(src, 'tools/validate_windows510.ps1'), 'utf8')), now = sections(ps);
  assert.deepEqual(now.filter(s => before.includes(s)), before); assert.deepEqual(now.filter(s => !before.includes(s)), ['self-test 5.11', 'streams 5.11']);
  const py = python(); if (py) { const r = cp.spawnSync(py, [path.join(src, 'tools/ps_lint571.py'), file], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stdout + r.stderr); }
  const pw = ['pwsh', 'powershell', path.join(os.homedir(), '.dotnet/tools/pwsh')].find(p => { try { return cp.spawnSync(p, ['-NoProfile', '-Command', 'exit 0'], { timeout: 60000 }).status === 0; } catch { return false; } });
  if (pw) { const r = cp.spawnSync(pw, ['-NoProfile', '-Command', "$e = $null; $t = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('" + file.replace(/'/g, "''") + "', [ref]$t, [ref]$e); if ($e.Count) { $e | ForEach-Object { $_.ToString() }; exit 1 }"], { encoding: 'utf8', timeout: 120000 }); assert.equal(r.status, 0, r.stdout + r.stderr); }
  for (const [name, needs] of [['Run 5.11 Windows validation.bat', ['mwcli.exe --selftest57 ', 'mwcli.exe --selftest571 ', 'mwcli.exe --selftest58 ', 'mwcli.exe --selftest59 ', 'mwcli.exe --selftest510 ', 'mwcli.exe --selftest511 ', 'validate_windows511.ps1" %*', 'Windows-selftest511-5.11.json', 'Windows-validation-5.11.json', 'Step 7 of 7', 'if not "%selftest511_result%"=="0" if "%eightmax_result%"=="0" set "eightmax_result=1"']],
    ['Run 5.11 focused validation.bat', ['mwcli.exe --selftest511 ', 'validate_windows511.ps1" -Focused %*', 'Windows-focused-validation-5.11.json']]]) {
    const f = path.join(root, name); if (!fs.existsSync(f)) continue;   // the launchers live in the release root, not in a bare source tree
    const b = fs.readFileSync(f); assert.ok(!/[^\x00-\x7f]/.test(b.toString('latin1')), name + ' is ASCII'); const text = b.toString('latin1');
    assert.ok(!/[^\r]\n/.test(text), name + ' has CRLF line ends'); for (const n of needs) assert.ok(text.includes(n), name + ': ' + n); assert.match(text, /exit \/b %\w+%\r\n$/);
    assert.match(text, /if not exist "Windows-(focused-)?validation-5\.11\.json" if "%eightmax_result%"=="0" set "eightmax_result=2"/, name + ': a missing report is not a pass');
    assert.ok(!text.includes('-5.10.json') && !text.includes('validate_windows510'), name + ' writes 5.11 reports only');
  }
  const dir = path.join(root, 'validation/5.11/windows/streams');
  if (fs.existsSync(dir)) {
    const ref = JSON.parse(fs.readFileSync(path.join(dir, 'reference.json'), 'utf8')); assert.match(ref.threads.stateSha256, /^[0-9a-f]{64}$/); assert.equal(ref.algorithm, ALGORITHM);
    for (const f of [ref.threads.spec, ...ref.throughput.flatMap(x => [x.streams510Spec, x.philox64Spec])]) assert.ok(fs.existsSync(path.join(dir, f)), f);
    const spec = JSON.parse(fs.readFileSync(path.join(dir, ref.threads.spec), 'utf8')); assert.equal(spec.trainingStreams, 'philox64'); assert.equal(spec.device, undefined, 'the script puts the processing mode in front'); assert.equal(JSON.parse(fs.readFileSync(path.join(dir, ref.throughput[0].streams510Spec), 'utf8')).trainingStreams, undefined);
  }
  const wf = path.join(root, '.github/workflows/windows.yml');
  if (fs.existsSync(wf)) { const y = fs.readFileSync(wf, 'utf8'); for (const s of ['--selftest511 source/studies', '--selftest510 source/studies', 'validate_windows511.ps1 -Root', 'Windows-validation-5.11.json', 'windows-selftest511.json', 'source/tests/v511.test.js']) assert.ok(y.includes(s), s); assert.ok(!/continue-on-error:\s*true/.test(y), 'no gate is allowed to fail silently'); }
});
