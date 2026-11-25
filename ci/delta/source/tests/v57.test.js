'use strict';
// EightMax 5.7 regression tests.
//   Parallel training: frozen-batch updates prepare, traverse and merge on several threads (mw_es_impl.hpp). The saved
//   state must not depend on the number of threads, on the measured thread choice or on which stages are spread, and
//   must equal the state of the 5.6 update (kept in the binary: EIGHTMAX_LEGACY_BATCH=1) and of the archived 5.6
//   binary, for every trainer option that reaches the frozen-batch path, when a table or dictionary limit stops the
//   training, and when a training is stopped and continued.
//   Evaluation: the evaluator's path tree (action_ev.hpp) changes no result: sampled and exact action EVs and response
//   gains are the same documents with EM_EV_NO_PATHS=1, and the same as the archived 5.6 binary's.
//   Studies: complete studies give the measurements of the archived 5.6 binary.
//   mwcli --selftest57: the in-engine checks and the golden states written by the 5.6 binary.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const build = require('./native_build');
const src = path.resolve(__dirname, '..'), fx = id => JSON.parse(fs.readFileSync(path.join(src, 'studies', id + '.emfix.json'), 'utf8'));
const cli = () => process.env.EM_TEST_MWCLI || build.cli().cli;
const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'em57-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const run = (args, env = {}, exe = null) => cp.spawnSync(exe || cli(), args.map(String), { encoding: 'utf8', timeout: 900000, maxBuffer: 256 << 20, env: { ...process.env, ...env } });
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const gameSpec = (d, game, extra, name) => { const p = path.join(d, (name || game) + '.json'); cp.execFileSync(process.execPath, [path.join(src, 'tools/games48.js'), 'spec', game, p, '977', JSON.stringify({ device: 'cpu', ...extra })]); return p; };
const fixtureSpec = (d, id, extra, name) => { const p = path.join(d, (name || id) + '.json'); fs.writeFileSync(p, JSON.stringify({ ...fx(id).variants[0].nativeSpec, ...extra })); return p; };
const train = (sp, updates, out, threads, mem, env = {}, from = null, exe = null) => { const r = run([sp, updates, threads, out, mem, ...(from ? [from] : [])], env, exe); assert.equal(r.status, 0, r.stderr + r.stdout); return JSON.parse(r.stdout); };
const FIXED = { EIGHTMAX_THREAD_CHOICE: 'fixed' }, LEGACY = { EIGHTMAX_LEGACY_BATCH: '1' }, FROZEN = { batchDeals: 64, actionStreams: 'deal' };
const COUNTERS = ['iterations', 'trainingDeals', 'stateVisits', 'rng', 'actionRng', 'rows', 'states', 'tableMiB', 'tableCapacityBytes', 'scratchBudgetBytes', 'attemptedDealsThisSession', 'transientLimitPerDealBytes', 'limitReached', 'batchDeals', 'weighting'];
const old56 = path.resolve(src, '../validation/5.6/linux-bin/mwcli');
const oldSkip = process.platform !== 'linux' || process.arch !== 'x64' ? 'the archived 5.6 binary is a Linux x86-64 program' : !fs.existsSync(old56) ? 'validation/5.6/linux-bin/mwcli is not present' : false;
const oldExe = d => { const exe = path.join(d, 'mwcli56'); fs.copyFileSync(old56, exe); fs.chmodSync(exe, 0o755); return exe; };
// Results of an evaluation document: everything except timings, memory readings and scheduling-dependent work counters.
const VOLATILE = new Set(['elapsedMs', 'deadline', 'execution', 'work', 'budgets', 'threads', 'engine', 'version']);
const results = x => Array.isArray(x) ? x.map(results) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).filter(([k]) => !VOLATILE.has(k)).map(([k, v]) => [k, results(v)])) : x;

// ---------------------------------------------------------------- parallel training
test('5.7 frozen batches: one state for every thread count, for the measured and the forced thread use and for the 5.6 update, with every trainer option', { timeout: 900000 }, t => {
  const d = tmp(t), deal = { actionStreams: 'deal' };
  const cases = [
    ['flop6w', { ...deal, batchDeals: 64 }, 300, 256], ['turn4', { ...deal, batchDeals: 64 }, 300, 256], ['final8w', { ...deal, batchDeals: 16 }, 600, 128], ['bubble4', { ...deal, batchDeals: 8 }, 1200, 128],
    ['flop5', { ...deal, batchDeals: 64, batchSchedule: { start: 4, doubleEvery: 50 } }, 400, 256], ['flop6', { ...deal, batchDeals: 8, weighting: 'dcfr' }, 1500, 128],
    ['turn4', { ...deal, batchDeals: 16, regretMatching: 'plus' }, 800, 128], ['hu-turn', { ...deal, batchDeals: 32, weighting: 'uniform' }, 500, 128],
    ['river3-chip', { ...deal, batchDeals: 4, opponentEnumeration: 'river', ownHandEnumeration: true }, 1500, 128], ['hu-river', { ...deal, batchDeals: 16, opponentEnumeration: 'river-shared' }, 800, 128],
    ['turn4', { ...deal, batchDeals: 16, opponentEnumeration: 'river-cross' }, 600, 128], ['flop6', { ...deal, batchDeals: 8 }, 3000, 1],
    ['flop5', { batchDeals: 16 }, 600, 128],   // one shared action stream: the deals of an update are traversed in order on one thread
  ];
  let runs = 0;
  for (const [game, options, updates, mem] of cases) {
    const sp = gameSpec(d, game, options, 'c' + runs), ref = path.join(d, 'ref.state'), label = game + ' ' + JSON.stringify(options);
    const want = train(sp, updates, ref, 1, mem, LEGACY), hash = sha(ref);
    for (const [threads, env] of [[1, {}], [2, FIXED], [3, FIXED], [4, FIXED], [8, FIXED], [4, {}], [4, LEGACY]]) {
      const out = path.join(d, 'out.state'), info = train(sp, updates, out, threads, mem, env); runs++;
      assert.equal(sha(out), hash, label + ' with ' + threads + ' threads ' + JSON.stringify(env));
      for (const k of COUNTERS) assert.deepEqual(info[k], want[k], label + ': ' + k + ' with ' + threads + ' threads ' + JSON.stringify(env));
    }
    const part = path.join(d, 'part.state'), two = path.join(d, 'two.state');
    const first = train(sp, Math.floor(updates / 3), part, 2, mem, FIXED);
    if (!first.limitReached) { const second = train(sp, updates - Math.floor(updates / 3), two, 4, mem, FIXED, part); if (!second.limitReached && !want.limitReached) assert.equal(sha(two), hash, label + ': stopped and continued with other thread counts'); }
  }
  assert.ok(runs >= 90);
});
test('5.7 frozen batches with hand groups (Compact and Detailed keys prepared on several threads): the state of the 5.6 update, also when the table budget stops the training', { timeout: 900000 }, t => {
  const d = tmp(t);
  for (const [id, updates, mem] of [['flop3-kings', 120, 1024], ['flop3-kings-detailed', 50, 1024], ['icm8-bb-call', 250, 1024], ['flop6-jack', 60, 1024], ['btn25-open', 80, 1024], ['flop3-kings', 400, 2], ['flop3-kings-detailed', 300, 3], ['btn25-open', 300, 1]]) {
    const sp = fixtureSpec(d, id, FROZEN, id + '-' + mem), ref = path.join(d, 'ref.state'); let want = train(sp, updates, ref, 1, mem, LEGACY), hash = sha(ref);
    if (mem < 16) assert.equal(want.limitReached, true, id + ' with ' + mem + ' MiB must reach its table limit for this test to mean something');
    for (const [threads, env] of [[1, {}], [2, FIXED], [4, FIXED], [8, FIXED], [4, {}]]) {
      // The workers' transient memory comes out of the table budget. When that budget is a few MiB, the update at which
      // the training stops depends on how many workers were created (5.6 behaves the same; see RELEASE-5.7.md), so a
      // stopped training is compared with the 5.6 update run with the same number of threads.
      if (mem < 16) { want = train(sp, updates, ref, threads, mem, LEGACY); hash = sha(ref); }
      const out = path.join(d, 'out.state'), info = train(sp, updates, out, threads, mem, env);
      assert.equal(sha(out), hash, id + ' ' + mem + ' MiB with ' + threads + ' threads ' + JSON.stringify(env));
      for (const k of COUNTERS) assert.deepEqual(info[k], want[k], id + ' ' + mem + ' MiB: ' + k + ' with ' + threads + ' threads ' + JSON.stringify(env));
    }
  }
});
test('5.7 against the archived 5.6 binary: frozen-batch states and counters are identical for 1 to 8 threads (games and grouped fixtures, fresh seeds)', { skip: oldSkip, timeout: 900000 }, t => {
  const d = tmp(t), exe = oldExe(d);
  const cases = [...['flop6w', 'final8w', 'turn4', 'flop5', 'bubble4', 'hu-turn'].map((g, i) => [gameSpec(d, g, { ...FROZEN, privateSeed: 5700 + i, actionSeed: 91 + i }, 'g' + i), 250, 256]),
                 ...['flop3-kings', 'flop6-jack', 'icm8-bb-call', 'btn25-open', 'flop3-kings-detailed'].map((id, i) => [fixtureSpec(d, id, { ...FROZEN, actionSeed: 57000 + i }, 'f' + i), 60, 1024])];
  for (const [sp, updates, mem] of cases) {
    const a = path.join(d, 'a.state'), ia = train(sp, updates, a, 4, mem, {}, null, exe), hash = sha(a);
    for (const [threads, env] of [[1, {}], [2, FIXED], [4, FIXED], [8, FIXED], [4, {}]]) {
      const b = path.join(d, 'b.state'), ib = train(sp, updates, b, threads, mem, env);
      assert.equal(sha(b), hash, sp + ' with ' + threads + ' threads');
      for (const k of COUNTERS) assert.deepEqual(ib[k], ia[k], sp + ': ' + k);
    }
  }
});
test('5.7 training output: stage seconds and the thread choice are reported; several threads are used when they are forced', { timeout: 300000 }, t => {
  const d = tmp(t), sp = gameSpec(d, 'flop6w', FROZEN), out = path.join(d, 's.state');
  const forced = train(sp, 400, out, 4, 256, FIXED), auto = train(sp, 400, out, 4, 256), one = train(sp, 400, out, 1, 256);
  for (const info of [forced, auto, one]) {
    const s = info.batchStages; assert.equal(s.updates, 400);
    for (const k of ['deal', 'prepare', 'fixup', 'traverse', 'resolve', 'accumulate', 'apply']) assert.ok(s[k] >= 0, k);
    assert.ok(Math.abs(s.deal + s.prepare + s.fixup - info.seconds.deal) < 1e-3 && Math.abs(s.traverse - info.seconds.traverse) < 1e-3 && s.resolve + s.accumulate + s.apply <= info.seconds.merge + 1e-3, 'the stages are parts of the 5.6 totals');
  }
  assert.equal(forced.threads, 4); assert.equal(forced.batchStages.updatesOnSeveralThreads, 400); assert.ok(forced.batchStages.dispatches >= 400);
  assert.equal(one.threads, 1); assert.equal(one.batchStages.updatesOnSeveralThreads, 0); assert.equal(one.batchStages.dispatches, 0);
  assert.ok(auto.threads >= 1 && auto.threads <= 4); assert.ok(auto.threadChoice.calibrations >= 1);
  const used = Object.entries(auto.threadChoice.updatesByThreads).reduce((n, [, v]) => n + v, 0); assert.equal(used, 400, 'every update is counted under the thread count it used');
  // one deal per update never uses the frozen-batch stages
  const b1 = train(gameSpec(d, 'flop6w', {}, 'b1'), 2000, out, 4, 256); assert.equal(b1.batchStages.updates, 0); assert.equal(b1.threads, 1);
});

// ---------------------------------------------------------------- evaluation
test('5.7 evaluator path tree: sampled and exact response gains and action EVs are the same with and without it, for chip EV, ICM and hand groups', { timeout: 900000 }, t => {
  const d = tmp(t);
  const gainQ = (name, body) => { const q = path.join(d, name + '.json'); fs.writeFileSync(q, JSON.stringify(body)); return q; };
  const sampled = gainQ('sampled', { method: 'sampled', samples: 3000, selectionSamples: 48, seed: 11, threads: 2, timeLimitMs: 600000 });
  const restricted = gainQ('restricted', { method: 'restricted', samples: 2000, selectionSamples: 32, seed: 11, threads: 2, timeLimitMs: 600000, maxVisits: 4000000 });
  const exact = gainQ('exact', { method: 'exact', device: 'cpu', threads: 2, timeLimitMs: 600000, maxVisits: 2000000000, memoryMiB: 256 });
  let compared = 0;
  for (const [id, updates, mem, queries] of [['btn25-open-small', 20000, 256, [sampled, restricted]], ['flop3-kings', 20000, 1024, [sampled]], ['icm8-bb-call', 20000, 1024, [sampled]], ['flop6-jack', 10000, 1024, [sampled]],
                                              ['flop6-jack-small', 5000, 512, [exact, sampled]], ['icm8-bb-call-small', 5000, 256, [exact, sampled]], ['flop3-kings-small', 5000, 512, [exact, restricted]]]) {
    const f = fx(id), sp = fixtureSpec(d, id, {}), st = path.join(d, id + '.state'); train(sp, updates, st, 1, mem);
    for (const q of queries) {
      const a = run(['--gain', sp, st, q, mem]), b = run(['--gain', sp, st, q, mem], { EM_EV_NO_PATHS: '1' });
      assert.equal(a.status, 0, id + ' ' + q + ': ' + a.stderr); assert.equal(b.status, 0, b.stderr);
      assert.deepEqual(results(JSON.parse(a.stdout)), results(JSON.parse(b.stdout)), id + ' ' + path.basename(q)); compared++;
    }
    const v = f.variants[0];
    for (const method of /-small$/.test(id) ? ['sampled', 'exact'] : ['sampled']) {   // exact action EVs only where the game is small
      const q = path.join(d, 'ev.json'); fs.writeFileSync(q, JSON.stringify({ path: v.decision.path, board: v.decision.board || [], hands: [v.decision.handIndex], method, samples: 4000, seed: 5, threads: 2, timeLimitMs: 120000, maxVisits: 20000000 }));
      const a = run(['--ev', sp, st, q]), b = run(['--ev', sp, st, q], { EM_EV_NO_PATHS: '1' });
      if (a.status !== 0) { assert.equal(b.status, a.status, id + ' ' + method + ': both refuse'); assert.equal(b.stderr, a.stderr); continue; }   // exact evaluation above its visit limit
      assert.equal(b.status, 0, b.stderr); assert.deepEqual(results(JSON.parse(a.stdout)), results(JSON.parse(b.stdout)), id + ' action EV ' + method); compared++;
    }
  }
  assert.ok(compared >= 20, compared + ' documents compared');
});
test('5.7 evaluator path tree with a small evaluator memory: nodes that do not fit are rebuilt and the result is unchanged', { timeout: 600000 }, t => {
  const d = tmp(t), sp = fixtureSpec(d, 'flop3-kings', {}), st = path.join(d, 's.state'); train(sp, 20000, st, 1, 1024);
  const doc = mem => { const q = path.join(d, 'q' + mem + '.json'); fs.writeFileSync(q, JSON.stringify({ method: 'sampled', samples: 1500, selectionSamples: 24, seed: 3, threads: 1, timeLimitMs: 600000, memoryMiB: mem })); const r = run(['--gain', sp, st, q, 1024]); assert.equal(r.status, 0, r.stderr); return results(JSON.parse(r.stdout)); };
  const small = doc(16), large = doc(2048);   // 16 MiB: a 256 KiB tree (about 540 betting states); 2,048 MiB: 8 MiB
  // The evaluator memory also bounds the table that counts distinct information sets (exact or a lower bound), so
  // those counts are left out; every value, error and sample count of the gains must be the same.
  const values = seats => seats.map(s => { const { distinctCountKind, distinctFallbackInformationSets, distinctInformationSets, ...rest } = s; return rest; });
  assert.deepEqual(values(small.seats), values(large.seats)); assert.ok(small.seats.every(s => s.available && Number.isFinite(s.gain.mean)));
});
test('5.7 against the archived 5.6 binary: sampled and exact evaluations of the same state are identical', { skip: oldSkip, timeout: 900000 }, t => {
  const d = tmp(t), exe = oldExe(d);
  const q = (name, body) => { const p = path.join(d, name + '.json'); fs.writeFileSync(p, JSON.stringify(body)); return p; };
  const sampled = q('s', { method: 'sampled', samples: 3000, selectionSamples: 48, seed: 21, threads: 2, timeLimitMs: 600000 }), exact = q('e', { method: 'exact', device: 'cpu', threads: 1, timeLimitMs: 600000, maxVisits: 2000000000, memoryMiB: 256 });
  for (const [id, updates, mem, query] of [['btn25-open-small', 20000, 256, sampled], ['flop3-kings', 20000, 1024, sampled], ['icm8-bb-call', 20000, 1024, sampled], ['flop6-jack', 10000, 1024, sampled], ['flop6-jack-small', 5000, 512, exact], ['icm8-bb-call-small', 5000, 256, exact], ['flop3-kings-small', 5000, 512, exact]]) {
    const sp = fixtureSpec(d, id, {}), st = path.join(d, id + '.state'), st56 = path.join(d, id + '.56.state'); train(sp, updates, st, 1, mem); train(sp, updates, st56, 1, mem, {}, null, exe);
    assert.equal(sha(st), sha(st56), id + ': the default trainer writes the 5.6 state');
    const a = run(['--gain', sp, st, query, mem]), b = run(['--gain', sp, st, query, mem], {}, exe); assert.equal(a.status, 0, a.stderr); assert.equal(b.status, 0, b.stderr);
    const ra = results(JSON.parse(a.stdout)), rb = results(JSON.parse(b.stdout));
    assert.deepEqual(ra.seats, rb.seats, id + ': seats'); assert.deepEqual(ra.summary, rb.summary, id + ': summary');
  }
});

// ---------------------------------------------------------------- complete studies
const points = doc => doc.variants.flatMap(v => v.perSeed.flatMap(s => s.budgets.map(p => ({ variant: v.name, seed: s.seed, budget: p.budgetDeals, deals: p.deals, rows: p.rows, frequency: p.frequency, ev: p.ev, evStdErr: p.evStdErr, fallbackShare: p.fallbackShare, pairedDiffStdErr: p.pairedDiffStdErr,
  quality: p.quality, qualityStdErr: p.qualityStdErr, seatGain: p.seatGain, seatGainStdErr: p.seatGainStdErr, evaluationSeed: p.evaluationSeed, qualitySeed: p.qualitySeed, evSamples: p.evSamples }))));
test('5.7 against the archived 5.6 binary: complete studies (sampled and exact evaluation, chip EV and ICM) give the same measurements', { skip: oldSkip, timeout: 1500000 }, t => {
  const d = tmp(t), exe = oldExe(d);
  for (const [id, opts] of [['known-akq-river', ['preset=quick']], ['btn25-open-small', ['seeds=2', 'budgets=4000,20000']], ['flop3-kings-small', ['seeds=2', 'budgets=2000,10000']], ['icm8-bb-call-small', ['seeds=2', 'budgets=1000,5000']], ['flop6-jack-small', ['seeds=2', 'budgets=1000,5000']]]) {
    const f = path.join(src, 'studies', id + '.emfix.json'), a = path.join(d, id + '.57.json'), b = path.join(d, id + '.56.json'), common = [...opts, 'threads=2', 'quiet=1', 'checkpoint=off', 'processingMode=cpu'];
    const ra = run(['--study', f, a, ...common, 'trainingStreams=5.10']), rb = run(['--study', f, b, ...common], {}, exe);   // 5.11: the 5.6 program trains with the 32-bit streams; this build is asked for them by name (a study that does not choose uses the counter-based streams)
    assert.equal(ra.status, 0, id + ': ' + ra.stderr); assert.equal(rb.status, 0, id + ' (5.6): ' + rb.stderr);
    const pa = points(JSON.parse(fs.readFileSync(a, 'utf8'))), pb = points(JSON.parse(fs.readFileSync(b, 'utf8')));
    assert.ok(pa.length >= 2, id); assert.deepEqual(pa, pb, id);
  }
});

// ---------------------------------------------------------------- the shipped self-test
test('5.7 mwcli --selftest57: in-engine checks, golden frozen-batch states of the 5.6 binary, evaluation with and without the path tree', { timeout: 1500000 }, t => {
  const d = tmp(t), r = run(['--selftest57', path.resolve(src, '../validation/5.7/fixtures'), d]);
  const rep = JSON.parse(fs.readFileSync(path.join(d, 'selftest57.json'), 'utf8'));
  assert.equal(rep.failed, 0, rep.checks.filter(c => !c.passed).map(c => c.name + ': ' + c.detail).join('\n')); assert.equal(r.status, 0, r.stderr.slice(-2000));
  assert.ok(rep.passed >= 28, rep.passed + ' checks'); assert.equal(rep.version, fs.readFileSync(path.join(src, 'VERSION'), 'utf8').trim());
  assert.ok(rep.checks.some(c => /worker pool/.test(c.name)) && rep.checks.some(c => /card code/.test(c.name)) && rep.checks.some(c => /path tree/.test(c.name)));
  assert.equal(run(['--selftest57']).status, 2, 'usage error without arguments');
  assert.equal(run(['--selftest57', path.join(d, 'no such fixtures'), d]).status, 2, 'a missing fixture folder is an error, not a pass');
});
