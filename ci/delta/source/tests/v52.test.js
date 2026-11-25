'use strict';
// EightMax 5.2 regression tests.
//  1. study fixtures: every shipped fixture is reproduced by the application's own construction and the engine
//     reaches the advertised decision with the advertised legal actions
//  2. decision study runner (mwcli --study, study52.hpp): a known small game with a closed-form mixed equilibrium,
//     an independent recomputation of the hero EVs from the trained strategy, an intentionally undertrained study,
//     determinism, agreement with the manual train + evaluate pipeline, sensitivity block, refused inputs
//  3. the report functions of the interface (EM.study): the rows, the CSV and the headline show the numbers of the
//     exported document
//  4. desktop host: /api/study/start|status|result|stop
//  5. checkpoints written by the 5.1 release executable (raw and EMZ1, including adaptive-schedule states saved
//     before, at and after a batch-size change) continue in 5.2 to the 5.1 uninterrupted states
//  6. processing modes: the 2,400-deal device fixture ends in one canonical state in all four modes
//  7. deadline telemetry: worker stage and join delay are reported; an exact result inside its deadline is returned
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const build = require('./native_build');
const E = require('../tools/loadlib'); for (const l of ['lib_runouts', 'lib_wide', 'lib_river', 'lib_river_ui', 'lib_study_ui']) require('../web/' + l);
const F = require('../tools/fixtures52');
const { withHost, home } = require('./checkpoint_host');
const tool = () => process.env.EM_TEST_MWCLI || build.cli().cli;
const cliSkip = !tool() && (build.cli().why || 'no native CLI');
const win = process.platform === 'win32';
const studies = path.join(__dirname, '..', 'studies'), V52 = path.join(__dirname, '..', '..', 'validation', '5.2', 'fixtures'), fixtures = path.join(__dirname, 'fixtures');
const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'em52-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const run = (a, env, o = {}) => cp.spawnSync(tool(), a.map(String), { encoding: 'utf8', maxBuffer: 256 << 20, env: { ...process.env, ...(env || {}) }, timeout: 900000, ...o });
const fileSha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const bodySha = f => { const b = fs.readFileSync(f), hl = b.readUInt32LE(8); return crypto.createHash('sha256').update(b.subarray(12 + hl)).digest('hex'); };
const fixture = id => JSON.parse(fs.readFileSync(path.join(studies, id + '.emfix.json'), 'utf8'));
function study(dir, id, opts = [], expect = 0) {
  const out = path.join(dir, id + '-' + crypto.randomBytes(3).toString('hex') + '.json');
  const r = run(['--study', path.join(studies, id + '.emfix.json'), out, 'quiet=1', ...opts]);
  assert.equal(r.status, expect, r.stderr + r.stdout);
  return expect ? r : { doc: JSON.parse(fs.readFileSync(out, 'utf8')), text: r.stdout, file: out };
}
// 5.5: the desktop checkpoints every study and runs seeds side by side; those are session fields (how the numbers were produced), not results
const strip = doc => JSON.parse(JSON.stringify(doc, (k, v) => /Seconds|PeakRss|elapsed|logicalProcessors|build|version|^checkpoint$|^checkpointPolicy$|^parallelSeeds|^threadsPerSeed$|MemoryBudget|^evaluationMemory|^physicalMemoryMiB$|^memoryPerSeedAllowanceMiB$|^tableMiB|^trainingThreads/i.test(k) ? undefined : v));

test('5.2 fixtures: the four studies, their companions and the over-limit fixture are shipped with the MTT defaults and complete descriptions', () => {
  const ids = fs.readdirSync(studies).filter(f => f.endsWith('.emfix.json')).map(f => f.replace('.emfix.json', '')).sort();
  assert.deepEqual(ids, ['btn25-open', 'btn25-open-small', 'flop3-kings', 'flop3-kings-detailed', 'flop3-kings-small', 'flop6-jack', 'flop6-jack-small', 'icm8-bb-call', 'icm8-bb-call-small', 'known-akq-river']);
  for (const id of ids) {
    const f = fixture(id); E.study.validateFixture(f);
    assert.equal(f.id, id);
    if (id !== 'known-akq-river') {
      assert.deepEqual([f.table.players, f.table.smallBlind, f.table.bigBlind, f.table.antePerPlayer, f.table.startingPotBeforeVoluntaryAction], [8, 0.5, 1, 0.1, 2.3], id + ': eight-handed 0.5 / 1 / 0.1 ante, 2.3 BB pot');
      for (const v of f.variants) assert.equal(v.game.dealt, 8, id + '/' + v.name + ': eight seats dealt in');
    }
    for (const k of ['effectiveStacksBB', 'actionHistory', 'board', 'betSizes', 'utility', 'abstraction', 'continuation', 'rangeWeights', 'assumptions', 'legalActions']) assert.ok(f.description[k] !== undefined, id + ': description.' + k);
    for (const v of f.variants) { assert.ok(v.ranges.every(r => r.combinations > 0 && r.weightSum > 0)); assert.ok(v.decision.actions.length >= 2); assert.equal(v.decision.seat, f.description.heroSeat); assert.equal(v.decision.hand, f.description.heroHand); }
    if (f.kind === 'realistic' || f.kind === 'companion') assert.deepEqual(f.variants.slice(0, 3).map(v => v.name), ['baseline', 'wider-range', 'added-size'], id + ': baseline, one wider range, one added size');
    if (f.kind === 'companion') { assert.ok(fixture(f.companionOf).companion === id); assert.ok(f.description.simplifications.length >= 2, id + ': the simplifications are listed'); }
  }
  // preflop pot of the button study is the 2.3 BB starting pot; weighted blind ranges; linked postflop continuation
  const b = fixture('btn25-open'); assert.equal(b.variants[0].decision.potBB, 2.3); assert.equal(b.variants[0].nativeSpec.rules.pre, true);
  assert.ok(new Set(b.variants[0].nativeSpec.hands[2].map(h => h[3])).size >= 3, 'weighted big blind range'); assert.ok(b.variants[0].nativeSpec.rules.sizes['3'].bets.length >= 1, 'flop betting is part of the tree');
  // three-way and six-way flops: two bet sizes, weighted ranges, the hero faces check / small / large
  for (const [id, n] of [['flop3-kings', 3], ['flop6-jack', 6]]) { const f = fixture(id), v = f.variants[0]; assert.equal(v.nativeSpec.n, n); assert.equal(v.decision.actions.filter(a => /^Bet/.test(a.name)).length, 2); assert.ok(v.nativeSpec.hands.every(h => new Set(h.map(x => x[3])).size >= 2), id + ': weighted ranges'); assert.equal(f.variants[2].decision.actions.length, 4, id + ': the added size is legal at the decision'); }
  // ICM: explicit stacks and payouts, and a chip-EV variant of the same spot in BB
  const i = fixture('icm8-bb-call'); assert.equal(Object.keys(i.description.stacksBB).length, 8); assert.equal(i.description.payouts.places.length, 8);
  assert.equal(i.variants[0].utility.model, 'icm'); assert.equal(i.variants[0].utility.unit, 'percent of the prize pool'); const chip = i.variants.find(v => v.name === 'chip-ev'); assert.equal(chip.utility.unit, 'BB'); assert.ok(!chip.nativeSpec.icm && i.variants[0].nativeSpec.icm);
  assert.deepEqual(chip.nativeSpec.hands, i.variants[0].nativeSpec.hands, 'same ranges'); assert.deepEqual(chip.nativeSpec.rules, i.variants[0].nativeSpec.rules, 'same stacks and actions');
});
test('5.2 fixtures: regenerating every fixture through the Multiway form -> game -> native specification -> engine walk reproduces the shipped files byte for byte', { skip: cliSkip, timeout: 600000 }, () => {
  for (const file of fs.readdirSync(studies).filter(f => f.endsWith('.emfix.json'))) {
    const id = file.replace('.emfix.json', ''); assert.equal(JSON.stringify(F.build(id, tool()), null, 1) + '\n', fs.readFileSync(path.join(studies, file), 'utf8'), id);
    const done = E.study.completeFixture(fixture(id)); assert.ok(done.checks.every(c => c.rebuiltEqualsStored === true), id + ': the interface rebuilds the stored specification');
    const compact = E.study.completeFixture(E.study.compactFixture(fixture(id))); assert.deepEqual(compact.fixture.variants.map(v => v.nativeSpec), fixture(id).variants.map(v => v.nativeSpec), id + ': the compact (embedded) form rebuilds the same specification');
  }
});
test('5.2 fixtures: a variant changes exactly one input', () => {
  for (const id of ['btn25-open', 'flop3-kings', 'flop6-jack', 'icm8-bb-call', 'btn25-open-small', 'flop3-kings-small', 'flop6-jack-small', 'icm8-bb-call-small']) {
    const f = fixture(id), base = f.variants[0].nativeSpec, clean = s => { const { studyId, ...r } = s; return r; };
    const w = clean(f.variants[1].nativeSpec), a = clean(f.variants[2].nativeSpec), b = clean(base);
    assert.deepEqual({ ...w, hands: null }, { ...b, hands: null }, id + ': the wider-range variant changes only ranges'); assert.notDeepEqual(w.hands, b.hands);
    assert.deepEqual({ ...a, rules: { ...a.rules, sizes: null } }, { ...b, rules: { ...b.rules, sizes: null } }, id + ': the added-size variant changes only the size menu'); assert.notDeepEqual(a.rules.sizes, b.rules.sizes);
    const extra = f.variants[2].decision.actions.map(x => x.label).filter(l => !f.variants[0].decision.actions.some(x => x.label === l));
    if (!/^icm8/.test(id)) assert.equal(extra.length, 1, id + ': one added legal action at the hero decision');   // ICM: the size is added to the button's menu, the hero's own actions stay call / fold
  }
});

// ---------------- known small game ----------------
test('5.2 study on a known game (A-K-Q river): frequencies, EV gap and verdict match the closed form; a true mix is reported as a near-tie, not as a ranking', { skip: cliSkip, timeout: 600000 }, t => {
  const { doc, text } = study(tmp(t), 'known-akq-river'), v = doc.variants[0];
  E.study.validateResult(doc);
  assert.equal(v.qualityMetric.kind, 'exact'); assert.equal(v.utility.unit, 'BB');
  assert.ok(v.firstBudgetMeetingTolerance != null, 'the declared tolerance is reached: ' + v.toleranceSummary);
  const b = v.budgets.find(x => x.budgetDeals === v.firstBudgetMeetingTolerance), call = b.actions.find(a => a.label === 'Call 10'), fold = b.actions.find(a => a.label === 'Fold');
  // closed form: pot 10, bet 10 -> call with probability 1/2, EV(call) = EV(fold) = 0
  assert.ok(Math.abs(call.frequency.mean - 0.5) < 0.02, 'call frequency ' + call.frequency.mean);
  assert.equal(fold.ev.mean, 0); assert.ok(Math.abs(call.ev.mean) <= doc.tolerance.evGap, 'EV(call) ' + call.ev.mean);
  assert.equal(b.verdict, 'nearTie', b.verdictText); assert.ok(Math.abs(b.gap.mean) <= doc.tolerance.evGap);
  assert.equal(b.gap.evaluationStdErrOfMean, 0, 'exact evaluation has no sampling error'); assert.ok(b.gap.betweenStrategySd >= 0);
  assert.ok(b.quality.mean <= doc.tolerance.quality);
  // budgets before it: larger quality metric, wider intervals; the first of several budgets can never meet the tolerance
  assert.equal(v.budgets[0].meetsTolerance, false); assert.equal(v.budgets[0].toleranceChecks.stableAcrossBudgets, null);
  assert.ok(v.budgets[0].quality.mean > v.budgets.at(-1).quality.mean * 5, 'the quality metric falls with the budget');
  assert.ok(v.budgets.every(x => x.verdict !== 'ranked'), 'a zero-gap decision is never reported as a ranking: ' + v.budgets.map(x => x.verdict));
  // the readable table is printed from the written document
  assert.match(text, /tolerance first met at/); assert.ok(text.includes((100 * call.frequency.mean).toFixed(2) + '%'));
  for (const s of v.perSeed) assert.equal(s.budgets.length, 5);
});
test('5.2 independent reference: hero EVs recomputed by hand from the trained strategies of the known game equal the evaluator\'s values', { skip: cliSkip, timeout: 600000 }, t => {
  const dir = tmp(t), f = fixture('known-akq-river'), v = f.variants[0], seed = 3, deals = 20000;
  const spec = path.join(dir, 's.json'), st = path.join(dir, 's.state'), q = path.join(dir, 'q.json');
  fs.writeFileSync(spec, JSON.stringify(E.MultiwayGame({ ...v.game, privateSeed: seed }).nativeSpec()));
  assert.equal(run([spec, deals, 1, st, 64]).status, 0);
  const node = p => { fs.writeFileSync(q, JSON.stringify({ path: p, board: [] })); const r = run(['--node', spec, st, q]); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };
  const root = node([]), bet = root.actions.findIndex(a => a.name === 'All-in'), name = h => h.cards.map(c => '23456789TJQKA'[c >> 2]).join('');
  const a = root.hands.items.find(h => name(h) === 'AA').average[bet], qq = root.hands.items.find(h => name(h) === 'QQ').average[bet];
  // seat 2 holds kings and faces the bet: it loses 10 to aces and wins the 10 BB pot plus the 10 BB bet from queens
  const evCall = (a * -10 + qq * 20) / (a + qq);
  fs.writeFileSync(q, JSON.stringify({ path: v.decision.path, board: [], hands: [v.decision.handIndex], method: 'exact' }));
  const ev = JSON.parse(run(['--ev', spec, st, q]).stdout).hands[0];
  assert.ok(Math.abs(ev.ev[1] - evCall) < 1e-9, 'evaluator ' + ev.ev[1] + ' vs closed form ' + evCall); assert.equal(ev.ev[0], 0);
  // and the study reports exactly these numbers for this seed and budget
  const { doc } = study(dir, 'known-akq-river', ['seeds=' + seed + ',' + (seed + 1), 'budgets=' + deals, 'trainingStreams=5.10']);   // 5.11: the manual training above uses the fixture's spec, that is the 5.10 streams; the study is asked for the same
  const p = doc.variants[0].perSeed[0].budgets[0]; assert.equal(p.ev[1], ev.ev[1]); assert.deepEqual(p.frequency, ev.strategy); assert.equal(p.deals, deals);
});
test('5.2 study seeds: the runner\'s per-seed game equals the application\'s game for that seed (manual train + evaluate gives the same numbers)', { skip: cliSkip, timeout: 600000 }, t => {
  const dir = tmp(t), f = fixture('flop3-kings-small'), v = f.variants[2], seed = f.study.seeds[1], deals = 3000;
  const { doc } = study(dir, 'flop3-kings-small', ['variants=added-size', 'seeds=' + f.study.seeds[0] + ',' + seed, 'budgets=1000,' + deals, 'trainingStreams=5.10']);   // 5.11: as above
  const spec = path.join(dir, 's.json'), st = path.join(dir, 's.state'), q = path.join(dir, 'q.json');
  fs.writeFileSync(spec, JSON.stringify(E.MultiwayGame({ ...v.game, privateSeed: seed }).nativeSpec()));
  assert.equal(run([spec, 1000, 2, st, 512]).status, 0); assert.equal(run([spec, deals - 1000, 1, st, 512, st]).status, 0);
  fs.writeFileSync(q, JSON.stringify({ path: v.decision.path, board: [], hands: [v.decision.handIndex], method: 'exact' }));
  const ev = JSON.parse(run(['--ev', spec, st, q]).stdout).hands[0];
  fs.writeFileSync(q, JSON.stringify({ method: 'exact' })); const gain = JSON.parse(run(['--gain', spec, st, q]).stdout);
  const p = doc.variants[0].perSeed[1].budgets[1];
  assert.deepEqual(p.ev, ev.ev); assert.deepEqual(p.frequency, ev.strategy); assert.equal(p.quality, gain.nashConv); assert.deepEqual(p.seatGain, gain.seats.map(s => s.gain));
});
test('5.2 an intentionally undertrained study never reaches its tolerance: the last measured gap and budget are shown', { skip: cliSkip, timeout: 600000 }, t => {
  const { doc, text } = study(tmp(t), 'flop3-kings-small', ['variants=baseline', 'seeds=3', 'budgets=100,200,400']), v = doc.variants[0];
  assert.equal(v.firstBudgetMeetingTolerance, null); assert.equal(v.lastMeasuredBudget, 400);
  assert.match(v.toleranceSummary, /tolerance not reached; last measured budget 400/); assert.match(text, /tolerance not reached; last measured budget 400/);
  const last = v.budgets.at(-1); assert.equal(last.meetsTolerance, false); assert.ok(last.gap && Number.isFinite(last.gap.mean) && last.gap.ci95.length === 2);
  assert.ok(last.quality.mean > doc.tolerance.quality, 'the quality metric is above its tolerance: ' + last.quality.mean);
  const h = E.study.headline(v); assert.equal(h.met, false); assert.equal(h.budget, 400); assert.match(h.text, /Declared tolerance NOT reached; last measured budget 400 deals/);
  assert.ok(h.mix.length > 0 && /EV gap .* = [+−]/.test(h.text), 'frequencies and the gap are shown plainly: ' + h.text);
});
test('5.2 study results are deterministic (same seeds and budgets, any worker count) and the two uncertainty sources are separate', { skip: cliSkip, timeout: 600000 }, t => {
  const dir = tmp(t), a = study(dir, 'btn25-open-small', ['variants=baseline', 'seeds=2', 'budgets=2000,6000', 'threads=1']).doc, b = study(dir, 'btn25-open-small', ['variants=baseline', 'seeds=2', 'budgets=2000,6000', 'threads=3']).doc;
  assert.deepEqual(strip(a).variants, strip(b).variants);
  const x = a.variants[0].budgets[1]; assert.equal(a.variants[0].qualityMetric.kind, 'sampled'); assert.match(a.variants[0].qualityMetric.meaning, /lower bound.*cannot certify/);
  // sampled evaluation: a paired evaluation standard error per seed, smaller than the unpaired combination
  const p = a.variants[0].perSeed[0].budgets[1]; assert.ok(p.evStdErr[1] > 0); assert.ok(p.pairedDiffStdErr[0][1] > 0 && p.pairedDiffStdErr[0][1] <= Math.hypot(p.evStdErr[0], p.evStdErr[1]) * 1.2 + 1e-12);
  assert.ok(x.gap.evaluationStdErrOfMean > 0); assert.ok(Number.isFinite(x.gap.sdAcrossSeeds)); assert.ok(x.gap.betweenStrategySd >= 0 && x.gap.betweenStrategySd <= x.gap.sdAcrossSeeds + 1e-12);
});
test('5.2 sensitivity: wider range and added size are compared with the baseline by seed; the added action is reported against the best original action', { skip: cliSkip, timeout: 600000 }, t => {
  const { doc } = study(tmp(t), 'flop3-kings-small', ['seeds=3', 'budgets=2000,20000']), s = doc.sensitivity;
  assert.equal(s.baseline, 'baseline'); assert.deepEqual(s.comparisons.map(c => c.variant), ['wider-range', 'added-size']);
  for (const c of s.comparisons) {
    assert.equal(c.budgetDeals, 20000); assert.equal(c.pairedSeeds, 3); assert.equal(c.sameUtility, true);
    assert.deepEqual(c.commonActions.map(a => a.label), ['Check', 'Bet to 2.442', 'Bet to 5.55']);
    for (const a of c.commonActions) { assert.ok(Math.abs(a.variantFrequency - a.baselineFrequency - a.frequencyChange.mean) < 1e-12); assert.equal(a.frequencyChange.n, 3); }
    assert.ok(c.seedsWhereLeaderByFrequencyChanged >= 0 && c.seedsWhereLeaderByFrequencyChanged <= 3); assert.ok(c.baselineGap && c.variantGap && c.baselinePairInVariant);
    assert.equal(typeof c.shiftWhileNearlyTied, 'boolean');
  }
  const add = s.comparisons[1].addedActions; assert.equal(add.length, 1); assert.equal(add[0].label, 'Bet to 9.25');
  const big = doc.variants[2], last = big.budgets.at(-1), ev = l => last.actions.find(a => a.label === l).ev.mean, best = ['Check', 'Bet to 2.442', 'Bet to 5.55'].sort((x, y) => ev(y) - ev(x))[0];
  assert.equal(add[0].advantageOverBestOriginal.bestOriginalAction, best); assert.ok(Math.abs(add[0].advantageOverBestOriginal.mean - (ev('Bet to 9.25') - ev(best))) < 1e-9);
  assert.equal(s.comparisons[0].addedActions.length, 0);
});
test('5.2 ICM and chip EV are never mixed: the chip-EV variant reports BB, the ICM variants percent of the prize pool, and EVs are not compared across them', { skip: cliSkip, timeout: 600000 }, t => {
  const { doc } = study(tmp(t), 'icm8-bb-call-small', ['variants=baseline,chip-ev', 'seeds=2', 'budgets=2000,20000']);
  assert.equal(doc.variants[0].utility.unit, 'percent of the prize pool'); assert.equal(doc.variants[1].utility.unit, 'BB');
  assert.equal(doc.variants[0].budgets[1].gap.unit, 'percent of the prize pool'); assert.equal(doc.variants[1].budgets[1].gap.unit, 'BB');
  const c = doc.sensitivity.comparisons[0]; assert.equal(c.sameUtility, false); assert.ok(c.commonActions.every(a => a.evChange === undefined && a.baselineEv === undefined));
  // fold keeps the hero's stack: its ICM value is a prize share between the last and the first prize, its chip value is minus the blind and ante
  const fold = v => v.budgets[1].actions.find(a => a.label === 'Fold').ev.mean; assert.ok(fold(doc.variants[0]) > 4 && fold(doc.variants[0]) < 30); assert.ok(Math.abs(fold(doc.variants[1]) + 1.1) < 1e-9);
});
test('5.2 a study that hits the strategy table budget records where each seed stopped and does not meet its tolerance', { skip: cliSkip, timeout: 600000 }, t => {
  const { doc } = study(tmp(t), 'flop3-kings-detailed', ['seeds=1', 'budgets=20000,400000', 'memoryMiB=24']), v = doc.variants[0], p = v.perSeed[0].budgets;
  const stopped = p.find(x => x.limitReached); assert.ok(stopped, 'the 24 MiB budget is reached'); assert.ok(stopped.deals < stopped.budgetDeals, 'stopped at ' + stopped.deals + ' deals');
  assert.ok(p.filter(b=>b.budgetDeals>stopped.budgetDeals).every(b=>b.status==='memoryLimit'&&!b.complete), 'later budgets explicitly record the memory stop'); assert.equal(v.firstBudgetMeetingTolerance, null);
  const b = v.budgets.find(x => x.budgetDeals === stopped.budgetDeals); assert.equal(b.seedsStoppedByMemoryLimit, 1); assert.equal(b.toleranceChecks.allSeedsReachedBudget, false);
  assert.ok(b.actions.some(a => a.untrainedContinuationShare > 0.2), 'the untrained share of the evaluation is reported');
});
test('5.2 mwcli --study refuses bad input with a reason and writes nothing', { skip: cliSkip, timeout: 300000 }, t => {
  const dir = tmp(t), fx = path.join(studies, 'known-akq-river.emfix.json'), out = path.join(dir, 'o.json');
  const cases = [[['seeds=99'], /seeds must be a count from 1 to 64/], [['budgets=5,5'], /budgets must increase/], [['variants=nope'], /no variant named/], [['budgets=x'], /budgets must be/], [['threads=0'], /threads must be/], [['bogus=1'], /unknown option/], [['memoryMiB=1'], /memoryMiB must be 16 to 65536/]];
  for (const [o, re] of cases) { const r = run(['--study', fx, out, ...o]); assert.notEqual(r.status, 0, o.join(' ')); assert.match(r.stderr, re); assert.ok(!fs.existsSync(out), o.join(' ') + ': nothing written'); }
  const bad = path.join(dir, 'bad.json'); fs.writeFileSync(bad, '{"format":"something else"}'); const r = run(['--study', bad, out]); assert.equal(r.status, 1); assert.match(r.stderr, /not an EightMax study fixture/);
  const f = fixture('known-akq-river'); f.variants[0].nativeSpec.n = 9; fs.writeFileSync(bad, JSON.stringify(f)); const r2 = run(['--study', bad, out]); assert.equal(r2.status, 1); assert.match(r2.stderr, /the engine refused the game/);
  // a fixture saved by a Windows editor with a byte-order mark is read
  fs.writeFileSync(bad, '﻿' + fs.readFileSync(fx, 'utf8')); assert.equal(run(['--study', bad, out, 'quiet=1', 'seeds=1', 'budgets=100']).status, 0);
  // more than 10,000,000 committed updates are refused by the engine: the study names the limit instead of reporting numbers
  const r3 = run(['--study', fx, path.join(dir, 'big.json'), 'quiet=1', 'seeds=1', 'budgets=10000001', 'trainingStreams=5.10']); assert.equal(r3.status, 1);   // 5.11: the limit of the 5.10 streams, selected by name assert.match(r3.stderr, /10 million iteration limit/);
});

// ---------------- interface report functions ----------------
test('5.2 interface report: table rows, CSV and headline carry exactly the numbers of the exported document', { skip: cliSkip, timeout: 600000 }, t => {
  const { doc } = study(tmp(t), 'flop3-kings-small', ['seeds=3', 'budgets=2000,20000']);
  const rows = E.study.rows(doc); assert.equal(rows.length, doc.variants.reduce((n, v) => n + v.budgets.reduce((m, b) => m + b.actions.length, 0), 0));
  for (const r of rows) {
    const v = doc.variants.find(x => x.name === r.variant), b = v.budgets.find(x => x.budgetDeals === r.budgetDeals), a = b.actions.find(x => x.label === r.action);
    assert.equal(r.frequencyMean, a.frequency.mean); assert.equal(r.evMean, a.ev.mean); assert.equal(r.evSdAcrossSeeds, a.ev.sdAcrossSeeds); assert.equal(r.gapMean, b.gap.mean); assert.deepEqual([r.gapCi95Low, r.gapCi95High], b.gap.ci95);
    assert.equal(r.qualityMean, b.quality.mean); assert.equal(r.trainingSecondsMean, b.trainingSecondsMean); assert.equal(r.processPeakRssMiB, b.processPeakRssMiB); assert.equal(r.verdict, b.verdict); assert.equal(r.utilityUnit, v.utility.unit);
  }
  const csv = E.study.toCSV(doc).split('\n'), head = csv[0].split(','); assert.deepEqual(head, E.study.COLUMNS);
  const first = csv[1].split(','); assert.equal(Number(first[head.indexOf('frequencyMean')]), rows[0].frequencyMean); assert.equal(Number(first[head.indexOf('gapMean')]), rows[0].gapMean); assert.equal(Number(first[head.indexOf('evMean')]), rows[0].evMean);
  // raw per-seed section of the CSV
  const rawAt = csv.findIndex(l => l.startsWith('study,variant,seed,')), raw = csv.slice(rawAt + 1).filter(Boolean); assert.equal(raw.length, doc.variants.reduce((n, v) => n + v.perSeed.reduce((m, s) => m + s.budgets.length * v.decision.actions.length, 0), 0));
  const r0 = raw[0].split(','), p0 = doc.variants[0].perSeed[0].budgets[0]; assert.equal(Number(r0[6]), p0.frequency[0]); assert.equal(Number(r0[7]), p0.ev[0]);
  for (const v of doc.variants) { const h = E.study.headline(v), b = v.budgets.find(x => x.budgetDeals === h.budget); assert.equal(h.gap.mean, b.gap.mean); assert.ok(h.text.includes(E.study.signed(b.gap.mean))); assert.ok(h.mix.includes(E.study.pct(h.actions[0].frequency, 0))); }
  assert.throws(() => E.study.validateResult({ format: 'x' }), /Not an EightMax study result/); assert.throws(() => E.study.validateFixture({}), /Not an EightMax study fixture/);
});

// ---------------- desktop host ----------------
const hostSkip = !(process.env.EM_TEST_HOST || build.host().exe) && (build.host().why || 'no native host');
test('5.2 native host: a study started through /api/study/start gives the result of mwcli --study; status, stop, concurrent start and bad requests', { skip: hostSkip || cliSkip, timeout: 600000 }, async t => {
  const dir = tmp(t), fx = fixture('known-akq-river'), options = { seeds: 3, budgets: [1000, 20000], threads: 2 };
  await withHost(home(t), {}, async api => {
    assert.equal((await (await api('info')).json()).studyApi, 1);
    assert.equal((await api('study/result')).status, 404);
    assert.equal((await api('study/start', '{"fixture":5}')).status, 400); assert.equal((await api('study/start', 'not json')).status, 400);
    assert.equal((await api('study/start', { fixture: fx, options })).status, 200);
    let st; for (let i = 0; i < 3000; i++) { st = await (await api('study/status')).json(); if (!st.running) break; await new Promise(r => setTimeout(r, 20)); }
    assert.equal(st.running, false); assert.equal(st.error, null); assert.equal(st.hasResult, true);
    const viaHost = await (await api('study/result')).json(), viaCli = study(dir, 'known-akq-river', ['seeds=3', 'budgets=1000,20000', 'threads=2']).doc;
    assert.deepEqual(strip(viaHost), strip(viaCli)); assert.match(viaHost.build, /^[0-9a-f]{16}$/);
    // a refused fixture is reported through the status; the previous result stays available
    assert.equal((await api('study/start', { fixture: { ...fx, format: 'other' } })).status, 200);
    for (let i = 0; i < 500; i++) { st = await (await api('study/status')).json(); if (!st.running) break; await new Promise(r => setTimeout(r, 10)); }
    assert.match(st.error, /not an EightMax study fixture/); assert.equal((await api('study/result')).status, 200);
    // stop: a long study ends early and reports only completed measurements; a second start while running is refused
    assert.equal((await api('study/start', { fixture: fixture('flop6-jack-small'), options: { seeds: 5, budgets: [200000, 2000000], threads: 2 } })).status, 200);
    assert.equal((await api('study/start', { fixture: fx, options })).status, 409);
    await new Promise(r => setTimeout(r, 300)); assert.equal((await api('study/stop', {})).status, 200);
    for (let i = 0; i < 6000; i++) { st = await (await api('study/status')).json(); if (!st.running) break; await new Promise(r => setTimeout(r, 20)); }
    assert.equal(st.running, false); const stopped = await (await api('study/result')).json(); assert.equal(stopped.fixture.id, 'flop6-jack-small'); assert.equal(stopped.run.stoppedByUser, true);
    assert.ok(stopped.variants.every(v => v.perSeed.every(s => s.budgets.every(b => typeof b.status==='string' && (!b.complete || b.ev.length === v.decision.actions.length)))), 'partial measurements retained and every seed/budget status reported');
  });
});

// ---------------- checkpoints written by 5.1 ----------------
test('5.2 checkpoints written by the 5.1 release executable (raw and EMZ1; adaptive schedule before, at and after a batch-size change) continue to the 5.1 uninterrupted states', { skip: cliSkip, timeout: 900000 }, t => {
  const dir = tmp(t), want = Object.fromEntries(fs.readFileSync(path.join(V52, 'v51-uninterrupted.sha256'), 'utf8').trim().split('\n').map(l => l.split(/\s+/).reverse()));
  const train = (spec, updates, threads, out, from) => { const r = run([path.join(V52, spec), updates, threads, out, 512, ...(from ? [path.join(V52, from)] : [])]); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };
  for (const f of ['v51-icm-150.state', 'v51-icm-150.emz']) { const o = path.join(dir, f + '.out'); train('icm-final8.spec.json', 150, 4, o, f); assert.equal(fileSha(o), want['ref-icm300.state'], f); }
  assert.equal(want['ref-icm300.state'], 'aa80974199182afa91d5a47166d32af0eb00ecff3ba334593eb5a359cc2e22b8', 'the golden ICM state of 4.5-5.1');
  for (const f of ['v51-es6w-60.state', 'v51-es6w-60.emz']) { const o = path.join(dir, f + '.out'); train('es6w-b64.spec.json', 60, 2, o, f); assert.equal(fileSha(o), want['ref-es120.state'], f); }
  for (const [f, n] of [['v51-sched-4.state', 4], ['v51-sched-5.state', 5], ['v51-sched-5.emz', 5], ['v51-sched-6.state', 6], ['v51-sched-14.state', 14], ['v51-sched-15.state', 15], ['v51-sched-15.emz', 15], ['v51-sched-16.state', 16]])
    for (const threads of [1, 4]) { const o = path.join(dir, f + threads + '.out'), info = train('sched-2-5-16.spec.json', 24 - n, threads, o, f); assert.equal(fileSha(o), want['ref24.state'], f + ' continued with ' + threads + ' workers'); assert.equal(info.iterations, 24); assert.equal(info.batchSchedule.nextBatchDeals, 16); }
  // 5.2 uninterrupted = 5.1 uninterrupted (regrets, averages, both RNGs, counters and schedule state are all in the file)
  const u = path.join(dir, 'u.state'), info = train('sched-2-5-16.spec.json', 24, 3, u); assert.equal(fileSha(u), want['ref24.state']);
  const si = JSON.parse(run(['--state-info', u]).stdout).state; assert.equal(si.header.iterations ?? info.iterations, 24);
  // the 5.0- and 4.9-written files of the 5.1 package still load (kept in validation/5.1 and 5.0)
  const v50 = path.join(__dirname, '..', '..', 'validation', '5.1', 'fixtures', 'v50-icm-150.emz'), o = path.join(dir, 'v50.out'); assert.equal(run([path.join(V52, 'icm-final8.spec.json'), 150, 4, o, 512, v50]).status, 0); assert.equal(fileSha(o), want['ref-icm300.state']);
  const v49 = path.join(__dirname, '..', '..', 'validation', '5.0', 'fixtures', 'v49-150.emz'), o2 = path.join(dir, 'v49.out'); assert.equal(run([path.join(V52, 'icm-final8.spec.json'), 150, 4, o2, 512, v49]).status, 0); assert.equal(fileSha(o2), want['ref-icm300.state']);
});

// ---------------- processing modes ----------------
const DEVICE_GOLDEN = '91786e3aa22cf1830df10bbadc72a3e2ae54bb31f0f84ed92dd0cd8c039bede6';
test('5.2 processing modes: the 2,400-deal device fixture ends in the canonical state (91786e3a...) in CPU Only, Automatic, GPU Preferred and Hybrid; Automatic does not open CUDA', { skip: cliSkip, timeout: 600000 }, t => {
  const dir = tmp(t), base = JSON.parse(fs.readFileSync(path.join(fixtures, 'device-turn.json'), 'utf8'));
  const double = win ? (process.env.EM_TEST_CUDA_FIXTURE ? { EM_TEST_CUDA_LIBRARY: process.env.EM_TEST_CUDA_FIXTURE } : null) : (build.cli().fixtureDir ? { LD_LIBRARY_PATH: build.cli().fixtureDir } : null);
  for (const env of [{}, ...(double ? [double] : [])]) for (const device of ['cpu', 'auto', 'gpu', 'hybrid']) {
    const spec = path.join(dir, device + '.json'), state = path.join(dir, device + '.state'); fs.writeFileSync(spec, JSON.stringify({ ...base, device }));
    const r = run([spec, 100, 4, state, 1024], env); assert.equal(r.status, 0, r.stderr); const info = JSON.parse(r.stdout), label = device + (env === double ? ' with the CUDA test double' : ' without a CUDA driver');
    assert.equal(bodySha(state), DEVICE_GOLDEN, label); assert.equal(info.trainingDeals, 2400); assert.equal(info.rng, 4225209845, label + ': RNG');
    const s = info.scheduling; if (device === 'auto') { assert.equal(s.cudaOpenedThisCall, false, label); assert.equal(s.automaticSkippedCuda, true); assert.equal(s.calibrationsThisCall, 0); }
    if (env === double && (device === 'gpu' || device === 'hybrid')) { assert.equal(s.cudaOpenedThisCall, true, label); assert.ok(s.calibrationsThisCall >= 1 && s.calibrationsThisCall + s.calibrationReusesThisCall === 100, label + ': ' + s.calibrationsThisCall + ' measured, ' + s.calibrationReusesThisCall + ' reused'); assert.ok(Object.keys(s.recalibrationReasons).length >= 1, 'the reasons are recorded'); }
  }
});

// ---------------- a stop inside a coverage-tier promotion ----------------
test('5.2 a stop that falls into a coverage-tier promotion is published by the promoting thread; the promotion is abandoned and the set stays exact (tests/coverage52.cpp)', { skip: (win && !process.env.EM_TEST_CXX) ? 'needs EM_TEST_CXX on Windows (compiler)' : false, timeout: 300000 }, t => {
  const dir = tmp(t), exe = path.join(dir, 'coverage52' + (win ? '.exe' : ''));
  try { cp.execFileSync(process.env.EM_TEST_CXX || 'g++', ['-std=c++20', '-O2', '-Wall', '-Wextra', '-Werror', '-I' + path.join(__dirname, '..', 'native'), path.join(__dirname, 'coverage52.cpp'), '-lpthread', '-o', exe, ...(win ? ['-static'] : [])], { stdio: 'pipe' }); }
  catch (e) { if (e.code === 'ENOENT') return t.skip('no C++ compiler'); throw e; }
  const r = cp.spawnSync(exe, [], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stdout + r.stderr);
  const rows = r.stdout.trim().split('\n').map(l => JSON.parse(l)); assert.equal(rows.at(-1).failures, 0); assert.equal(rows.length, 9); assert.ok(rows.slice(0, 8).every(x => x.passed), r.stdout);
});
test('5.2 EM_EV_PROMOTION_CHECK=0 (5.1 behaviour) and the default give identical evaluation results', { skip: cliSkip, timeout: 600000 }, t => {
  const dir = tmp(t), f = fixture('icm8-bb-call'), v = f.variants[0], spec = path.join(dir, 's.json'), st = path.join(dir, 's.state'), q = path.join(dir, 'q.json');
  fs.writeFileSync(spec, JSON.stringify(v.nativeSpec)); assert.equal(run([spec, 3000, 2, st, 512]).status, 0);
  fs.writeFileSync(q, JSON.stringify({ path: v.decision.path, board: [], hands: [v.decision.handIndex], range: true, method: 'sampled', samples: 60000, seed: 9, threads: 2 }));
  const a = JSON.parse(run(['--ev', spec, st, q]).stdout), b = JSON.parse(run(['--ev', spec, st, q], { EM_EV_PROMOTION_CHECK: '0' }).stdout);
  assert.deepEqual(a.hands[0].evBits, b.hands[0].evBits); assert.deepEqual(a.hands[0].strategy, b.hands[0].strategy); assert.equal(a.status, 'completed');
});

// ---------------- deadline telemetry ----------------
test('5.2 deadline telemetry: a timed-out exact evaluation reports the slowest worker\'s stage, its gap and the join time; a result that completes inside its deadline is returned', { skip: cliSkip, timeout: 600000 }, t => {
  const dir = tmp(t), f = fixture('icm8-bb-call'), v = f.variants[0], spec = path.join(dir, 's.json'), st = path.join(dir, 's.state'), q = path.join(dir, 'q.json');
  fs.writeFileSync(spec, JSON.stringify(v.nativeSpec)); assert.equal(run([spec, 2000, 2, st, 512]).status, 0);
  fs.writeFileSync(q, JSON.stringify({ path: v.decision.path, board: [], hands: [v.decision.handIndex], method: 'exact', timeLimitMs: 100, threads: 4, maxVisits: 2000000000 }));
  const r = run(['--ev', spec, st, q], { EM_QUERY_TIMING: '1' }); assert.notEqual(r.status, 0); const line = JSON.parse(r.stderr.split('\n')[0]), e = line.evaluator;
  assert.equal(line.status, 408); assert.ok(e.stopObservedMs >= 100 && e.stopObservedMs < 250, 'stop observed at ' + e.stopObservedMs);
  for (const k of ['lastWorkerNoticedAfterStopMs', 'lastWorkerGapMs', 'lastWorkerSite', 'lastWorkerPreviousSite', 'workersEndedMs', 'workersJoinedMs']) assert.ok(k in e, k);
  // with a single evaluation worker (a one-CPU machine) there is no worker thread to join: -1
  assert.ok(e.workersJoinedMs === -1 || (e.workersJoinedMs >= e.stopObservedMs - 0.001 && e.workersJoinedMs <= line.queryMs + 0.5), 'joined at ' + e.workersJoinedMs + ' of ' + line.queryMs);
  // -1 / "none": no worker checked the clock again after the stop was published (the worker that published it was the last one working)
  assert.ok(e.lastWorkerNoticedAfterStopMs === -1 || (e.lastWorkerNoticedAfterStopMs >= 0 && e.lastWorkerNoticedAfterStopMs <= line.queryMs - e.stopObservedMs + 0.5), 'last worker ' + e.lastWorkerNoticedAfterStopMs); assert.match(e.lastWorkerSite, /^[a-z]+$/);
  assert.ok(line.queryMs < 100 + 150, 'returned after ' + line.queryMs + ' ms');
  // a valid exact result that finishes inside its deadline is preserved
  const k = fixture('known-akq-river').variants[0], s2 = path.join(dir, 'k.json'), st2 = path.join(dir, 'k.state'); fs.writeFileSync(s2, JSON.stringify(k.nativeSpec)); assert.equal(run([s2, 500, 1, st2, 64]).status, 0);
  fs.writeFileSync(q, JSON.stringify({ path: k.decision.path, board: [], hands: [k.decision.handIndex], method: 'exact', timeLimitMs: 100 }));
  const ok = run(['--ev', s2, st2, q], { EM_QUERY_TIMING: '1' }); assert.equal(ok.status, 0, ok.stderr); assert.equal(JSON.parse(ok.stdout).status, 'completed'); assert.equal(JSON.parse(ok.stderr.split('\n')[0]).evaluator.stopCode, 0);
});
