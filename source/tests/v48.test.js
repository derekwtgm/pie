'use strict';
// EightMax 4.8 regression tests.
//   Priority 4  - response evaluation optimisations (rank cache, hoisted pot layout, chip-only
//                 utility, table-cache caps) change no result: exact, restricted and sampled gains
//                 are bit-identical to the 4.7 code paths (environment switches) on multiway games;
//                 tight memory budgets give identical results; deadlines stop promptly.
//   Priority 3/14 - exact best responses agree with an independent multi-street implementation
//                 (tools/independent_br48.py: own rules, evaluator, side pots, chance enumeration);
//                 the best response is information-set consistent by construction there; chips
//                 are conserved for every profile; sampled intervals cover exact action EVs.
//   Priority 5  - the four-player continuation fixture (valid hand indices, recorded substitution,
//                 unchanged 4.5 sequence, invalid hand indices still refused).
//   Priority 8  - checkpoint comparison quality classes (improvement / regression / no change /
//                 inconclusive / not comparable).
//   Priority 7  - dashboard charts 1b, 7, 8 from a real monitor run; equal-time comparison math.
//   Priority 11 - EMZ1 levels: byte-exact round trips and deterministic resumes.
//   Priority 13/15 - golden training state unchanged; CUDA request without a device falls back to
//                 the CPU with identical results; tournament defaults unchanged.
//   Priority 12 - Windows harness: End-Section records completed sections as completed.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const E = require('../tools/loadlib');
for (const l of ['lib_runouts', 'lib_wide', 'lib_river', 'lib_dashboard']) require('../web/' + l);
const G = require('../tools/games48');
const build = require('./native_build');
const tool = () => process.env.EM_TEST_MWCLI || build.cli().cli;
const skip = !tool() && (build.cli().why || 'no native CLI');
const py = (() => { for (const c of ['python3', 'python']) { try { cp.execFileSync(c, ['--version'], { stdio: 'ignore' }); return c; } catch {} } return null; })();
const spec45 = path.join(__dirname, '..', '..', 'validation', '4.5', 'fixtures', 'icm-final8.spec.json');
const GOLDEN_300 = 'aa80974199182afa91d5a47166d32af0eb00ecff3ba334593eb5a359cc2e22b8';
const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'em48-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const cli = (args, env = {}) => cp.spawnSync(tool(), args.map(String), { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 900000, maxBuffer: 1 << 28 });
const json = r => { assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };
const writeJson = (dir, name, o) => { const f = path.join(dir, name); fs.writeFileSync(f, JSON.stringify(o)); return f; };
// train a study game once per test: returns {spec, state}
function trained(dir, key, deals, extra = {}, seed = 5, name = key) {
  const s = G.spec(key, seed, extra), spec = writeJson(dir, name + '.json', s), state = path.join(dir, name + '.state');
  json(cli([spec, Math.round(deals / (s.batchDeals || 1)), 2, state, 512])); return { spec, state };
}
const gain = (spec, state, req, env) => json(cli(['--gain', spec, state, writeJson(path.dirname(state), 'q' + crypto.randomBytes(4).toString('hex') + '.json', req)], env));
const LEGACY = { EM_EV_NO_RANK_CACHE: '1', EM_BR_NO_HOIST: '1', EM_EV_SMALL_TABLE_CAP: '4', EM_EV_TABLE_CAP: '0' };

// ---------------------------------------------------------------- Priority 4: bit identity
test('4.8 exact response gains are bit-identical to the 4.7 code path on heads-up to six-player games (rank cache, hoisted pots, table caps)', { skip, timeout: 1200000 }, t => {
  const dir = tmp(t);
  for (const key of ['hu-river', 'river3-chip', 'turn4', 'flop5', 'flop6', 'bubble4']) {
    const { spec, state } = trained(dir, key, 20000);
    for (const threads of [1, 4]) {
      const now = gain(spec, state, { method: 'exact', threads }), old = gain(spec, state, { method: 'exact', threads }, LEGACY);
      assert.deepEqual(now.seats.map(s => s.gainBits), old.seats.map(s => s.gainBits), key + ' threads ' + threads);
      assert.deepEqual(now.seats.map(s => [s.policyValue, s.bestResponseValue]), old.seats.map(s => [s.policyValue, s.bestResponseValue]), key);
      assert.equal(now.nashConv, old.nashConv);
    }
  }
});
test('4.8 restricted and sampled response gains are bit-identical to the 4.7 code path (multiway, side pots, ICM)', { skip, timeout: 1200000 }, t => {
  const dir = tmp(t);
  for (const key of ['river3-chip', 'turn4', 'flop6', 'bubble4']) {
    const { spec, state } = trained(dir, key, 20000);
    const r = gain(spec, state, { method: 'restricted', threads: 2 }), rOld = gain(spec, state, { method: 'restricted', threads: 2 }, LEGACY);
    assert.deepEqual(r.seats.map(s => s.gainBits || s.gain), rOld.seats.map(s => s.gainBits || s.gain), key + ' restricted');
    const q = { method: 'sampled', samples: 4000, seed: 9, threads: 2 }, s1 = gain(spec, state, q), s0 = gain(spec, state, q, LEGACY);
    assert.deepEqual(s1.seats.map(s => [s.gain, s.stdErr]), s0.seats.map(s => [s.gain, s.stdErr]), key + ' sampled');
  }
});
test('4.8 exact action EVs are bit-identical to the 4.7 code path (six-player flop, every root hand)', { skip, timeout: 600000 }, t => {
  const dir = tmp(t), { spec, state } = trained(dir, 'flop6', 20000);
  const q = writeJson(dir, 'ev.json', { path: [], hands: [0, 1], method: 'exact', threads: 2 });
  const a = json(cli(['--ev', spec, state, q])), b = json(cli(['--ev', spec, state, q], LEGACY));
  assert.deepEqual(a.hands.map(h => h.evBits), b.hands.map(h => h.evBits));
});
test('4.8 response evaluation under a tight memory budget (16 MiB) gives the same exact gains as 512 MiB (tables evicted, never approximated)', { skip, timeout: 600000 }, t => {
  const dir = tmp(t);
  for (const key of ['flop6', 'turn4', 'flop6w']) {
    const { spec, state } = trained(dir, key, 20000);
    const big = gain(spec, state, { method: 'exact', threads: 2, memoryMiB: 512 }), small = gain(spec, state, { method: 'exact', threads: 2, memoryMiB: 16 });
    assert.deepEqual(small.seats.map(s => s.gainBits), big.seats.map(s => s.gainBits), key);
    assert.ok(small.execution.peakEvaluationMiB <= 16.5, key + ' evaluation memory stays inside 16 MiB: ' + small.execution.peakEvaluationMiB);
  }
});
test('4.8 a long exact evaluation stops promptly at its deadline with a clear error (weighted six-player flop, 300 ms)', { skip, timeout: 300000 }, t => {
  const dir = tmp(t), { spec, state } = trained(dir, 'flop6w', 20000);
  const t0 = Date.now(), r = cli(['--gain', spec, state, writeJson(dir, 'd.json', { method: 'exact', timeLimitMs: 300, threads: 2 })]), ms = Date.now() - t0;
  assert.notEqual(r.status, 0); assert.match(r.stderr, /Time limit reached/);
  assert.ok(ms < 5000, 'stopped after ' + ms + ' ms');
});
test('4.8 the shared table cache builds each preflop all-in table once per request (four-player bubble: 16 tables, 4.7 rule: hundreds)', { skip, timeout: 600000 }, t => {
  const dir = tmp(t), { spec, state } = trained(dir, 'bubble4', 20000);
  const now = gain(spec, state, { method: 'exact', threads: 2 }), old = gain(spec, state, { method: 'exact', threads: 2 }, { EM_EV_TABLE_CAP: '0' });
  assert.deepEqual(now.seats.map(s => s.gainBits), old.seats.map(s => s.gainBits));
  assert.ok(now.execution.showdownTables <= 32, 'tables ' + now.execution.showdownTables);
  assert.ok(old.execution.showdownTables > 4 * now.execution.showdownTables, '4.7 rule rebuilds tables: ' + old.execution.showdownTables);
});

// ---------------------------------------------------------------- Priority 3/14: independent best response
test('4.8 exact best responses agree with the independent multi-street implementation (heads-up turn, three-player river, four-player turn) and chips are conserved', { skip: (skip || (!py && 'python unavailable')), timeout: 1200000 }, t => {
  const dir = tmp(t);
  for (const key of ['hu-turn', 'river3-chip', 'turn4']) {
    const { spec, state } = trained(dir, key, 20000);
    const r = cp.spawnSync(py, ['-I', path.join(__dirname, '..', 'tools', 'independent_br48.py'), tool(), spec, state], { encoding: 'utf8', timeout: 900000 });
    const out = JSON.parse(r.stdout);
    assert.equal(out.agree, true, key + ': ' + JSON.stringify(out.seats));
    assert.equal(out.chipConservation.conserved, true, key);
    assert.ok(out.storedRowsUsed > 0.9 * out.storedRows, key + ' uses the stored strategy rows');
    for (const s of out.seats) assert.ok(s.maxAbsDifference < 1e-12, key + ' seat ' + s.seat + ' ' + s.maxAbsDifference);
  }
});
test('4.8 best response >= policy value for every seat, and gains sum to NashConv (five- and six-player flops)', { skip, timeout: 600000 }, t => {
  const dir = tmp(t);
  for (const key of ['flop5', 'flop6']) {
    const { spec, state } = trained(dir, key, 4000);
    const g = gain(spec, state, { method: 'exact', threads: 2 });
    let sum = 0; for (const s of g.seats) { assert.ok(s.bestResponseValue >= s.policyValue - 1e-12); sum += s.gain; }
    assert.equal(g.nashConv, sum); assert.equal(g.exploitability, null, 'no exploitability claim for more than two seats');
    const pot0 = JSON.parse(fs.readFileSync(spec, 'utf8')).rules.pot0, pv = g.seats.reduce((a, s) => a + s.policyValue, 0);
    assert.ok(Math.abs(pv - pot0) < 1e-9, key + ' chips conserved: ' + pv + ' vs ' + pot0);
  }
});
test('4.8 sampled action-EV intervals cover the exact action EVs at the nominal rate (40 seeds, three-player river)', { skip, timeout: 600000 }, t => {
  const dir = tmp(t), { spec, state } = trained(dir, 'river3-chip', 20000);
  const exact = json(cli(['--ev', spec, state, writeJson(dir, 'e.json', { path: [], hands: [0, 1, 2], method: 'exact', threads: 1 })]));
  let covered = 0, total = 0, zsum = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const s = json(cli(['--ev', spec, state, writeJson(dir, 's.json', { path: [], hands: [0, 1, 2], method: 'sampled', samples: 600, seed, threads: 1 })]));
    s.hands.forEach((h, i) => h.ev.forEach((v, a) => { const ci = h.ci95[a], x = exact.hands[i].ev[a]; if (!(h.stdErr[a] > 1e-6)) return; total++; if (x >= ci[0] && x <= ci[1]) covered++; zsum += (v - x) / h.stdErr[a]; }));
  }
  assert.ok(total >= 80, 'intervals ' + total);
  assert.ok(covered / total >= 0.88, 'coverage ' + covered + '/' + total);
  assert.ok(Math.abs(zsum / total) < 0.35, 'mean standardized error ' + zsum / total);
});

// ---------------------------------------------------------------- Priority 5: four-player fixture
test('4.8 continuation suite on the four-player bubble study (own-hand enumeration): 25/25 with valid, recorded evaluation hands', { skip, timeout: 1200000 }, t => {
  const dir = tmp(t), spec = writeJson(dir, 'own-bubble4.json', G.spec('bubble4', 1, { ownHandEnumeration: true }));
  const r = cli(['--continuation-suite', spec, path.join(dir, 'suite'), 'standard', '4']);
  const out = JSON.parse(fs.readFileSync(path.join(dir, 'suite', 'continuation-suite.json'), 'utf8'));
  assert.equal(r.status, 0, out.checks.filter(c => !c.passed).map(c => c.name + ' ' + (c.detail || '')).join('\n'));
  assert.equal(out.checksFailed, 0); assert.ok(out.checksPassed >= 25);
  const h = out.evaluationHands; assert.equal(h.length, 2);
  for (const x of h) { assert.equal(x.rootActor, 0); assert.equal(x.rangeSize, 2); assert.ok(x.usedIndex >= 0 && x.usedIndex < x.rangeSize); }
  assert.equal(h[0].preferredIndex, 3); assert.equal(h[0].usedIndex, 1); assert.equal(h[0].substituted, true);
  assert.equal(h[1].usedIndex, 0); assert.equal(h[1].substituted, false);
});
test('4.8 continuation suite keeps the 4.5 eight-player sequence byte for byte (hands [3] and [0], no substitution)', { skip, timeout: 1200000 }, t => {
  const dir = tmp(t), r = cli(['--continuation-suite', spec45, path.join(dir, 'suite'), 'quick', '4']);
  const out = JSON.parse(fs.readFileSync(path.join(dir, 'suite', 'continuation-suite.json'), 'utf8'));
  assert.equal(r.status, 0); assert.equal(out.checksFailed, 0);
  const reqs = out.steps.filter(s => s.kind === 'evaluation').map(s => s.request);
  assert.deepEqual(reqs, ['{"path":[],"hands":[3],"range":true,"method":"sampled","samples":2000000,"timeLimitMs":250,"threads":4,"coverageMiB":1}', '{"path":[],"hands":[0],"method":"sampled","samples":3000,"seed":7,"threads":2}']);
  assert.ok(out.evaluationHands.every(x => !x.substituted && x.rangeSize === 1326));
});
test('4.8 an evaluation request naming a hand outside the root actor\'s range is still refused (incompatible fixture), and the suite fails clearly on a missing spec', { skip, timeout: 300000 }, t => {
  const dir = tmp(t), { spec, state } = trained(dir, 'bubble4', 4000);
  const r = cli(['--ev', spec, state, writeJson(dir, 'bad.json', { path: [], hands: [3], method: 'sampled', samples: 1000 })]);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /not in the acting seat's range \(2 hands\)/);
  const m = cli(['--continuation-suite', path.join(dir, 'missing.json'), path.join(dir, 'x'), 'quick', '2']);
  assert.notEqual(m.status, 0);
});
test('4.8 checkpoint continuation: four-player study 150 + 150 = 300 uninterrupted, with own hands and with the default trainer; restored state evaluates identically', { skip, timeout: 600000 }, t => {
  const dir = tmp(t);
  for (const extra of [{}, { ownHandEnumeration: true }]) {
    const spec = writeJson(dir, 's.json', G.spec('bubble4', 3, extra)), a = path.join(dir, 'a'), b = path.join(dir, 'b'), c = path.join(dir, 'c');
    json(cli([spec, 150, 4, a, 512])); json(cli([spec, 150, 1, b, 512, a])); json(cli([spec, 300, 2, c, 512]));
    assert.equal(sha(b), sha(c), JSON.stringify(extra));
    const q = { method: 'exact', threads: 2 }; assert.deepEqual(gain(spec, b, q).seats.map(s => s.gainBits), gain(spec, c, q).seats.map(s => s.gainBits));
  }
});

// ---------------------------------------------------------------- Priority 8: comparison classes
test('4.8 checkpoint comparison classifies quality changes (exact improvement / regression / no change; sampled with an interval; restricted not ordered)', { skip, timeout: 600000 }, t => {
  const dir = tmp(t), spec = writeJson(dir, 's.json', G.spec('flop6', 4)), early = path.join(dir, 'early'), late = path.join(dir, 'late');
  json(cli([spec, 2000, 2, early, 512])); json(cli([spec, 98000, 2, late, 512, early]));
  const cmp = (a, b, g) => JSON.parse(cli(['--compare', spec, a, b, 'gains=' + g, 'samples=4000']).stdout);
  const e = cmp(early, late, 'exact'); assert.equal(e.tool, 'mwcli compare 4.8');
  const better = e.gains.qualityChange.nashConvB < e.gains.qualityChange.nashConvA;
  assert.equal(e.gains.qualityChange.class, better ? 'meaningful improvement' : 'meaningful regression');
  assert.equal(cmp(late, early, 'exact').gains.qualityChange.class, better ? 'meaningful regression' : 'meaningful improvement');
  assert.equal(cmp(late, late, 'exact').gains.qualityChange.class, 'no change (equal within rounding)');
  const s = cmp(early, late, 'sampled').gains.qualityChange;
  assert.ok(['meaningful improvement', 'meaningful regression', 'statistically inconclusive'].includes(s.class)); assert.equal(s.ci95.length, 2); assert.ok(s.ci95[0] <= s.differenceBminusA && s.differenceBminusA <= s.ci95[1]);
  assert.equal(cmp(early, late, 'restricted').gains.qualityChange.class, 'not comparable (lower bounds)');
});

// ---------------------------------------------------------------- Priority 7: dashboard
test('4.8 dashboard: charts 1b, 7 and 8 are drawn from a real monitor run; equal-time comparison and improvement factors are exact functions of the analytics rows', { skip, timeout: 600000 }, t => {
  const dir = tmp(t), A = EM.analytics;
  const runs = [{}, { opponentExploration: 0.2 }].map((extra, i) => {
    const spec = writeJson(dir, 's' + i + '.json', G.spec('river3-chip', 2, extra)), out = path.join(dir, 'm' + i);
    const r = cli(['--monitor', spec, out, 'updates=20000', 'eval=exact', 'first=500', 'growth=3', 'threads=1']); assert.equal(r.status, 0, r.stderr);
    return JSON.parse(fs.readFileSync(path.join(out, 'analytics.json'), 'utf8'));
  });
  const html = A.chartsHTML(runs);
  for (const title of ['1b · Strategy quality: NashConv against training time', '7 · Algorithm comparison at equal training time', '8 · Training efficiency']) assert.ok(html.includes(title), title);
  const rows = runs.map(d => d.evaluations.filter(r => r.evaluation && r.evaluation.nashConv > 0 && r.trainSeconds > 0));
  assert.ok(rows[0].length >= 3 && rows[1].length >= 3);
  const cmp = A.equalTimeComparison(rows);
  for (const p of cmp[1]) {   // every point: interpolated NashConv of run 1 at a time of run 0, divided by run 0's value
    const r0 = rows[0].find(r => r.trainSeconds === p.x); assert.ok(r0);
    const r1 = rows[1]; let k = 1; while (k < r1.length && r1[k].trainSeconds < p.x) k++;
    const a = r1[Math.max(0, k - 1)], b = r1[Math.min(k, r1.length - 1)];
    const f = b.trainSeconds === a.trainSeconds ? 0 : (Math.log(p.x) - Math.log(a.trainSeconds)) / (Math.log(b.trainSeconds) - Math.log(a.trainSeconds));
    const want = Math.exp(Math.log(a.evaluation.nashConv) + f * (Math.log(b.evaluation.nashConv) - Math.log(a.evaluation.nashConv))) / r0.evaluation.nashConv;
    assert.ok(Math.abs(p.y - want) <= 1e-12 * want, p.y + ' vs ' + want);
  }
  assert.match(A.trainerLabel(runs[0].trainer), /\(default\)/); assert.match(A.trainerLabel(runs[1].trainer), /exploration 0\.2/);
  // never mock data: an empty document list draws no points
  assert.ok(!A.chartsHTML([{ evaluations: [] }]).includes('<circle'));
});

// ---------------------------------------------------------------- Priority 11: EMZ1 levels
test('4.8 EMZ1 at levels 1 and 9: byte-exact round trips and resumes equal to uninterrupted training', { skip, timeout: 600000 }, t => {
  const dir = tmp(t), spec = writeJson(dir, 's.json', G.spec('turn4', 6)), st = path.join(dir, 'a'), ref = path.join(dir, 'ref');
  json(cli([spec, 5000, 2, st, 512])); json(cli([spec, 5100, 2, ref, 512]));
  for (const level of [1, 9]) {
    const z = path.join(dir, 'a' + level + '.emz'), back = path.join(dir, 'b'), res = path.join(dir, 'r');
    assert.equal(cli(['--compress', st, z, level]).status, 0); assert.equal(cli(['--decompress', z, back]).status, 0);
    assert.equal(sha(back), sha(st)); json(cli([spec, 100, 2, res, 512, z])); assert.equal(sha(res), sha(ref), 'level ' + level);
  }
});

// ---------------------------------------------------------------- Priority 13/15: unchanged defaults
test('4.8 default trainer still writes the 4.4-4.7 golden state (300 updates, 4 threads) and reports itself as the validated default', { skip, timeout: 300000 }, t => {
  const dir = tmp(t), st = path.join(dir, 'g.state'), info = json(cli([spec45, 300, 4, st, 512]));
  assert.equal(sha(st), GOLDEN_300); assert.equal(info.trainer.validatedDefault, true); assert.equal(info.trainer.opponentExploration, 0.1);
});
test('4.8 a GPU request on a machine without a usable CUDA device falls back to the CPU with bit-identical exact gains', { skip, timeout: 600000 }, t => {
  const dir = tmp(t), { spec, state } = trained(dir, 'bubble4', 20000);
  const env = { LD_LIBRARY_PATH: '', EIGHTMAX_GPU: '' };
  const g = gain(spec, state, { method: 'exact', device: 'gpu', threads: 2 }, env), c = gain(spec, state, { method: 'exact', device: 'cpu', threads: 2 }, env);
  assert.deepEqual(g.seats.map(s => s.gainBits), c.seats.map(s => s.gainBits));
  assert.equal(g.execution.gpuBoards, 0); assert.ok(g.execution.scheduling.cpuGpuUnavailable > 0);
});
test('4.8 tournament defaults are unchanged: 8 players, 0.5/1 blinds, 0.1 bb antes, 2.3 bb starting pot, UTG..BB', t => {
  const holes = ['AsAh', 'KsKh', 'QsQh', 'JsJh', 'TsTh', '9s9h', '8s8h', '7s7h'];
  const g = E.MultiwayGame({ preflop: { mode: 'linked', opens: '2', raises: '3x,a', maxBets: 3 }, board: '', dealt: 8, common: 0, stacks: Array(8).fill(25), ranges: holes, privateMode: 'sampled', evaluationDeals: 128, bets: '50', raises: '', maxBets: 1 });
  const root = g.view([]);
  assert.ok(Math.abs(root.pot - 2.3) < 1e-12, 'eight-player starting pot ' + root.pot + ' (0.5 + 1 + 8 x 0.1)');
  assert.equal(root.seat, 0, 'UTG acts first');
  assert.ok(+fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8').trim() >= 4.8, 'version 4.8 or later');   // 4.9: was an exact '4.8' check (not a tournament default)
  assert.equal(typeof EM.analytics.seatLabel, 'function');
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(s => EM.analytics.seatLabel(s, 8, true)), ['UTG', 'UTG+1', 'MP', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
});

// ---------------------------------------------------------------- Priority 1/6: six-player sanity
test('4.8 six-player flop: the default trainer lowers exact NashConv from 4,000 to 100,000 sampled deals for three seeds (sanity, not a study)', { skip, timeout: 900000 }, t => {
  const dir = tmp(t);
  for (const seed of [11, 12, 13]) {
    const spec = writeJson(dir, 's.json', G.spec('flop6', seed)), a = path.join(dir, 'a'), b = path.join(dir, 'b');
    json(cli([spec, 4000, 1, a, 512])); json(cli([spec, 96000, 1, b, 512, a]));
    const q = { method: 'exact', threads: 2 }, na = gain(spec, a, q).nashConv, nb = gain(spec, b, q).nashConv;
    assert.ok(nb < na, 'seed ' + seed + ': ' + na + ' -> ' + nb);
  }
});

// ---------------------------------------------------------------- Priority 12: Windows harness
test('4.8 Windows harness: End-Section takes an untyped error so a completed section is not recorded as failed; Error-Text never returns an empty string', () => {
  const ps = fs.readFileSync(path.join(__dirname, '..', 'tools', 'test_windows.ps1'), 'utf8');
  assert.match(ps, /function End-Section\(\$errorText\)/);
  assert.doesNotMatch(ps, /function End-Section\(\[string\]/);
  assert.match(ps, /IsNullOrEmpty\(\[string\]\$errorText\)/);
  assert.match(ps, /error without a message/);
  const wf = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'windows.yml'), 'utf8');
  for (const f of (wf.match(/RELEASE-[0-9.]+\.md/g) || [])) assert.ok(fs.existsSync(path.join(__dirname, '..', '..', f)), 'workflow copies ' + f);
});
