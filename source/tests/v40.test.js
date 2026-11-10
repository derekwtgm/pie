'use strict';
// EightMax 4.0 regressions: EV deadline enforcement and cancellation in every
// expensive phase, partial exact-result rejection, background evaluation jobs,
// exact-EV numerical parity (showdown tables vs the 3.9 per-board enumeration,
// thread counts, CPU vs CUDA test double vs hybrid), GPU failure handling,
// sampled-EV uncertainty and thread invariance, strategy-coverage warnings and
// fallback sensitivity, statistical classifications (no equivalence from a
// non-significant difference), restricted best responses, solver-state
// integrity around evaluations, and eight-handed blind/ante/side-pot accounting.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
const E = require('../tools/loadlib');
for (const l of ['lib_runouts', 'lib_wide', 'lib_river', 'lib_pushfold', 'lib_explorer']) require('../web/' + l);
const { withHost, home } = require('./checkpoint_host');
const build = require('./native_build');
const tool = () => process.env.EM_TEST_MWCLI || build.cli().cli;
const skip = !tool() && (build.cli().why || 'no native CLI');
const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'em40-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const base = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128 };
const R3 = ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc'];
const FIXED8 = ['AsAh', 'KsKh', 'QsQh', 'JsJh', 'TsTh', '9s9h', '8s8h', '7s7h'], STACKS8 = [30, 22, 15, 40, 9, 18, 25, 12], PAY8 = [30, 20, 14, 11, 9, 7, 5, 4];
const studies = {
  huRiver: { ...base, board: 'Ks8d5h2c2s', common: 10, stacks: [20, 20], ranges: R3.slice(0, 2), streets: { river: { bets: '50,a', raises: 'a', maxBets: 2 } }, privateSeed: 3 },
  threeSide: { ...base, board: 'Ks8d5h2c2s', common: 6, stacks: [4, 12, 30], ranges: R3, streets: { river: { bets: '75,a', raises: 'a', maxBets: 2 } }, privateSeed: 5 },
  threeIcm: { ...base, board: 'Ks8d5h2c2s', common: 6, stacks: [4, 12, 30], ranges: R3, icm: { payouts: [50, 30, 20], others: [10] }, streets: { river: { bets: '75,a', raises: 'a', maxBets: 2 } }, privateSeed: 5 },
  huTurn: { ...base, board: 'Ks8d5h2c', common: 8, stacks: [12, 12], ranges: ['AhKh,KdQd,8s8h,JsTs', 'AsKd,5d5c,8h7h,JdTd'], streets: { turn: { bets: 'a', raises: '', maxBets: 1 }, river: { bets: '50', raises: '', maxBets: 1 } }, privateSeed: 7 },
  bubble: { ...base, preflop: { mode: 'shove' }, dealt: 4, common: 0, board: '', stacks: [12, 7, 20, 4], ranges: Array(4).fill('random'), icm: { payouts: [50, 30, 20] }, batchDeals: 4, actionStreams: 'deal', privateSeed: 8 },
  icmFinal: { ...base, preflop: { mode: 'linked', opens: '2.2,a', raises: 'a', maxBets: 2 }, board: '', dealt: 8, common: 0, stacks: STACKS8, ranges: Array(8).fill('random'), icm: { payouts: PAY8 }, streets: { flop: { bets: '50', raises: '', maxBets: 1 }, turn: { bets: 'a', raises: '', maxBets: 1 }, river: { bets: 'a', raises: '', maxBets: 1 } }, batchDeals: 4, actionStreams: 'deal', privateSeed: 4 },
  // the scenario of the independently reproduced 3.9 defect: eight seats, preflop, fixed non-overlapping hands, ICM
  push8: { ...base, preflop: { mode: 'shove' }, board: '', dealt: 8, common: 0, stacks: STACKS8, ranges: FIXED8, icm: { payouts: PAY8 }, batchDeals: 4, actionStreams: 'deal', privateSeed: 4 },
  push4: { ...base, preflop: { mode: 'shove' }, board: '', dealt: 4, common: 0, stacks: [10, 14, 6, 20], ranges: ['AsAh', 'KsKh', 'QsQh', 'JsJh'], icm: { payouts: [50, 30, 20] }, batchDeals: 4, actionStreams: 'deal', privateSeed: 2 },
  push8chip: { ...base, preflop: { mode: 'shove' }, board: '', dealt: 8, common: 0, stacks: STACKS8, ranges: FIXED8, batchDeals: 4, actionStreams: 'deal', privateSeed: 4 },
  linked8: { ...base, preflop: { mode: 'linked', opens: '2.2,a', raises: 'a', maxBets: 2 }, board: '', dealt: 8, common: 0, stacks: STACKS8, ranges: FIXED8, icm: { payouts: PAY8 }, streets: { flop: { bets: '50', raises: '', maxBets: 1 }, turn: { bets: 'a', raises: '', maxBets: 1 }, river: { bets: 'a', raises: '', maxBets: 1 } }, batchDeals: 4, actionStreams: 'deal', privateSeed: 4 },
};
function study(t, name, iterations, threads = 1) {
  const dir = tmp(t), spec = path.join(dir, 'spec.json'), state = path.join(dir, 'state');
  fs.writeFileSync(spec, JSON.stringify(E.MultiwayGame(studies[name]).nativeSpec()));
  cp.execFileSync(tool(), [spec, iterations, threads, state, 512].map(String), { encoding: 'utf8' });
  let qn = 0;
  // run(mode, query, env) -> {json, error, timing}; timing = the CLI's stderr line {queryMs, cancelLatencyMs?, status}
  const run = (mode, q, env = {}) => {
    const f = path.join(dir, 'q' + (qn++) + '.json'); fs.writeFileSync(f, typeof q === 'string' ? q : JSON.stringify(q));
    const r = cp.spawnSync(tool(), [mode, spec, state, f], { encoding: 'utf8', maxBuffer: 64 << 20, env: { ...process.env, EM_QUERY_TIMING: '1', ...env }, timeout: 120000 });
    const lines = (r.stderr || '').trim().split('\n'); let timing = null; try { timing = JSON.parse(lines[0]); } catch { }
    const error = lines.slice(timing ? 1 : 0).join('\n').trim();
    return { json: r.status === 0 ? JSON.parse(r.stdout) : null, error: r.status === 0 ? '' : error, timing, signal: r.signal, stdout: r.stdout };
  };
  return { dir, spec, state, specJson: JSON.parse(fs.readFileSync(spec, 'utf8')), run, ev: (q, env) => run('--ev', q, env), gain: (q, env) => run('--gain', q, env), node: q => run('--node', q).json };
}
const rel = (a, b) => Math.abs(a - b) / Math.max(1, Math.abs(b));
const fixture = () => { const c = build.cli(); return c.fixtureDir && process.platform === 'linux' ? { LD_LIBRARY_PATH: c.fixtureDir } : null; };
// Deadline tolerance documented in MW-PROTOCOL.md / RELEASE-4.0.md: the evaluation returns within
// timeLimitMs + 50 ms on an idle machine (measured: +1..8 ms). The assertions allow +150 ms for loaded CI.
const TOLERANCE_MS = 150;

// ============================== Priority 1: deadlines and cancellation ==============================
test('4.0 reproduced 3.9 defect: 8-player preflop ICM exact EV with fixed hands honours a 100 ms deadline (3.9: 10.2 s)', { skip }, t => {
  const S = study(t, 'push8', 50, 2);
  for (const path of [[], [1], [1, 1]]) {
    const r = S.ev({ path, board: [], hands: [0], method: 'exact', timeLimitMs: 100, maxVisits: 2000000000 });
    assert.equal(r.json, null, 'no exact result is published after a timeout');
    assert.match(r.error, /^error 408: Time limit reached .*an incomplete exact result is never reported/);
    assert.ok(r.timing.queryMs < 100 + TOLERANCE_MS, 'path ' + path + ' returned after ' + r.timing.queryMs + ' ms');
  }
});
test('4.0 deadlines hold for other limits and games, and the evaluator stays responsive after repeated timeouts', { skip }, t => {
  const S = study(t, 'push8', 50, 2), L = study(t, 'linked8', 40, 2), F = study(t, 'icmFinal', 20, 2);
  for (const [X, q] of [[S, { path: [], hands: [0], method: 'exact' }], [L, { path: [], hands: [0], method: 'exact' }], [F, { path: [], hands: [0, 1, 2], method: 'exact' }], [F, { path: [], hands: [3], range: true, method: 'sampled', samples: 2000000 }]])
    for (const ms of [100, 250, 600]) {
      const r = X.ev({ ...q, timeLimitMs: ms, maxVisits: 2000000000 });
      assert.ok(r.timing.queryMs < ms + TOLERANCE_MS, JSON.stringify(q) + ' limit ' + ms + ' took ' + r.timing.queryMs);
      if (q.method === 'exact') assert.equal(r.timing.status, 408);
      else { assert.equal(r.json.status, 'partial'); assert.equal(r.json.stoppedEarly, true); assert.ok(r.json.hands[0].samples >= r.json.minSamples); }
    }
  // ten consecutive timeouts, then a normal completed evaluation of the same node
  const times = []; for (let i = 0; i < 10; i++) times.push(S.ev({ path: [1, 1], hands: [0], method: 'exact', timeLimitMs: 100 }).timing.queryMs);
  assert.ok(Math.max(...times) < 100 + TOLERANCE_MS, times.join(' '));
  const ok = S.ev({ path: [1, 1], hands: [0], method: 'exact', timeLimitMs: 120000, maxVisits: 2000000000 });
  assert.equal(ok.json.status, 'completed'); assert.ok(ok.json.hands[0].ev.every(Number.isFinite));
  assert.ok(ok.json.deadline.maxCheckGapMs < 100, 'largest gap between deadline checks ' + ok.json.deadline.maxCheckGapMs + ' ms');
});
test('4.0 external cancellation stops exact, sampled and response-gain evaluations promptly', { skip }, t => {
  const S = study(t, 'push8', 50, 2), F = study(t, 'icmFinal', 20, 2);
  for (const [X, mode, q] of [[S, '--ev', { path: [], hands: [0], method: 'exact', timeLimitMs: 600000, maxVisits: 2000000000 }], [F, '--ev', { path: [], hands: [0], method: 'sampled', samples: 2000000, timeLimitMs: 600000 }],
    [F, '--gain', { method: 'sampled', samples: 2000000, timeLimitMs: 600000 }], [F, '--gain', { method: 'restricted', selection: 'sampled', samples: 2000000, timeLimitMs: 600000 }]]) {
    const r = X.run(mode, q, { EM_CANCEL_AFTER_MS: '150' });
    assert.equal(r.timing.status, 409, mode + ' ' + JSON.stringify(q)); assert.match(r.error, /cancelled/);
    assert.ok(r.timing.cancelLatencyMs < 100, mode + ' cancellation latency ' + r.timing.cancelLatencyMs + ' ms');
  }
});
test('4.0 cancellation is honoured inside every expensive phase (fault injection at each poll site)', { skip }, t => {
  const S = study(t, 'push8', 30, 2), T = study(t, 'huTurn', 300), H = study(t, 'huRiver', 300), F = study(t, 'icmFinal', 10, 2);
  const cases = [
    ['tree', S, '--ev', { path: [1, 1], hands: [0], method: 'exact' }, {}],
    ['runout', S, '--ev', { path: [1, 1], hands: [0], method: 'exact' }, { EM_EV_NO_TABLES: '1' }],
    ['table', S, '--ev', { path: [1, 1], hands: [0], method: 'exact', device: 'cpu' }, {}],
    ['pattern', S, '--ev', { path: [1, 1], hands: [0], method: 'exact' }, {}],
    ['icm', S, '--ev', { path: [1, 1], hands: [0], method: 'exact' }, {}],
    ['opponents', H, '--ev', { path: [], hands: [0], method: 'exact' }, {}],
    ['reach', H, '--ev', { path: [], hands: [0], method: 'exact' }, {}],
    ['subtree', H, '--ev', { path: [], hands: [0], method: 'exact' }, {}],
    ['chance', T, '--ev', { path: [], hands: [0], method: 'exact' }, {}],
    ['retry', F, '--ev', { path: [], hands: [0], method: 'sampled', samples: 1000 }, {}],
    ['sample', F, '--ev', { path: [], hands: [0], method: 'sampled', samples: 1000 }, {}],
    ['br', H, '--gain', { method: 'exact' }, {}],
    ['tuples', H, '--gain', { method: 'exact' }, {}],
    ['selection', H, '--gain', { method: 'restricted' }, {}],
  ];
  for (const [site, X, mode, q, env] of cases) {
    const r = X.run(mode, { ...q, timeLimitMs: 600000 }, { EM_EV_FAULT: site + ':3', ...env });
    assert.equal(r.timing && r.timing.status, 409, site + ': ' + r.error);
    assert.match(r.error, /Calculation cancelled \(during [a-zA-Z -]+\); no result is reported/, site);
    assert.equal(r.json, null, site + ': no result after cancellation');
  }
});

// ============================== Priority 3/8/9/10: exact parity, threads, devices ==============================
test('4.0 exact EVs from showdown tables equal the 3.9 per-board enumeration, for every thread count (bit-identical across threads)', { skip }, t => {
  const S = study(t, 'push8', 50, 2), C = study(t, 'push8chip', 50, 2), H = study(t, 'threeIcm', 600), T = study(t, 'huTurn', 300);
  for (const [X, q] of [[S, { path: [1, 1], hands: [0] }], [C, { path: [1, 1, 1], hands: [0] }], [H, { path: [], hands: [0, 1, 2], range: true }], [T, { path: [], hands: [0, 1], range: true }], [T, { path: [1], hands: [0, 1, 2, 3] }]]) {
    const ref = X.ev({ ...q, method: 'exact', threads: 1, maxVisits: 2000000000, timeLimitMs: 600000 }, { EM_EV_NO_TABLES: '1' }).json;
    assert.equal(ref.execution.showdownTables, 0);
    const one = X.ev({ ...q, method: 'exact', threads: 1, maxVisits: 2000000000, timeLimitMs: 600000 }).json;
    const many = X.ev({ ...q, method: 'exact', threads: 3, maxVisits: 2000000000, timeLimitMs: 600000 }).json;
    for (let i = 0; i < ref.hands.length; i++) {
      if (!ref.hands[i].available) { assert.equal(one.hands[i].available, false); continue; }
      ref.hands[i].ev.forEach((v, a) => assert.ok(rel(one.hands[i].ev[a], v) < 1e-9, 'table vs per-board ' + v + ' ' + one.hands[i].ev[a]));
      assert.deepEqual(many.hands[i].ev, one.hands[i].ev, 'thread count must not change exact EVs');
    }
    if (q.range) assert.deepEqual(many.range.ev, one.range.ev);
  }
});
test('4.0 CUDA path (driver test double running score.cu): GPU, hybrid and CPU showdown tables give bit-identical EVs; failures fall back to the CPU', { skip: skip || !fixture() }, t => {
  const S = study(t, 'push8', 40, 2), q = { path: [1, 1, 1], hands: [0], method: 'exact', maxVisits: 2000000000, timeLimitMs: 600000 };
  const cpu = S.ev({ ...q, device: 'cpu' }).json; assert.equal(cpu.execution.gpuBoards, 0);
  const gpu = S.ev({ ...q, device: 'gpu' }, fixture()).json;
  assert.ok(gpu.execution.gpuBoards > 0, JSON.stringify(gpu.execution)); assert.deepEqual(gpu.hands[0].ev, cpu.hands[0].ev);
  const hyb = S.ev({ ...q, device: 'hybrid', threads: 1 }, fixture()).json;
  assert.ok(hyb.execution.gpuBoards > 0 && hyb.execution.cpuBoards > 0, JSON.stringify(hyb.execution)); assert.deepEqual(hyb.hands[0].ev, cpu.hands[0].ev);
  for (const fault of ['alloc', 'launch', 'download', 'mismatch', 'missing', 'oldgpu', 'pressure']) {
    const r = S.ev({ ...q, device: 'gpu' }, { ...fixture(), EM_FIXTURE_FAULT: fault }).json;
    assert.ok(r, fault); assert.deepEqual(r.hands[0].ev, cpu.hands[0].ev, fault + ' changed the EV');
    assert.equal(r.execution.gpuBoards, 0, fault); assert.ok(r.execution.gpuNote, fault + ' reports why the GPU was not used');
  }
  // CPU-only machines: no driver at all
  const none = S.ev({ ...q, device: 'gpu' }, { LD_LIBRARY_PATH: '/nonexistent' }).json;
  assert.deepEqual(none.hands[0].ev, cpu.hands[0].ev); assert.match(none.execution.gpuNote, /unavailable/);
});

test('4.0 evaluation memory budget: a showdown table larger than memoryMiB falls back to per-board enumeration with the same EVs', { skip }, t => {
  const S = study(t, 'push4', 60), q = { path: [], hands: [0], method: 'exact', maxVisits: 2000000000, timeLimitMs: 600000 };
  const big = S.ev(q).json, small = S.ev({ ...q, memoryMiB: 16 }).json;   // C(44,5) boards x 4 seats x 4 bytes = 17.4 MB > 16 MiB
  // several workers never hold more tables than the budget allows together (atomic reservation)
  const two = S.ev({ ...q, memoryMiB: 20, threads: 4 }).json; assert.ok(two.execution.peakEvaluationMiB <= 20, 'peak ' + two.execution.peakEvaluationMiB);
  two.hands[0].ev.forEach((v, a) => assert.ok(rel(v, big.hands[0].ev[a]) < 1e-9));
  assert.ok(big.execution.showdownTables > 0 && big.execution.perBoardTerminals === 0, JSON.stringify(big.execution));
  assert.ok(small.execution.perBoardTerminals > 0 && small.execution.showdownTables === 0, JSON.stringify(small.execution));
  assert.ok(small.execution.peakEvaluationMiB <= 16, 'peak ' + small.execution.peakEvaluationMiB);
  big.hands[0].ev.forEach((v, a) => assert.ok(rel(small.hands[0].ev[a], v) < 1e-9));
  assert.match(S.ev({ ...q, memoryMiB: 8 }).error, /memoryMiB must be from 16/);
});
// ============================== Priority 3/4: sampled EVs and statistics ==============================
test('4.0 sampled EVs: thread-count invariant for a fixed seed, consistent with exact values, CI shrinks ~1/sqrt(N)', { skip }, t => {
  const S = study(t, 'threeIcm', 800), exact = S.ev({ path: [], hands: [0, 3], method: 'exact' }).json; const z = [];
  for (const seed of [1, 2, 3]) {
    const a = S.ev({ path: [], hands: [0, 3], method: 'sampled', samples: 4000, seed, threads: 1 }).json, b = S.ev({ path: [], hands: [0, 3], method: 'sampled', samples: 4000, seed, threads: 4 }).json;
    assert.deepEqual(b.hands, a.hands, 'sampled results must not depend on the thread count');
    for (let h = 0; h < 2; h++) for (let x = 0; x < a.actions.length; x++) if (a.hands[h].stdErr[x] > 0) z.push((a.hands[h].ev[x] - exact.hands[h].ev[x]) / a.hands[h].stdErr[x]);
  }
  assert.ok(z.length >= 6 && z.every(v => Math.abs(v) < 4.5), z.map(v => v.toFixed(2)).join(' '));
  const small = S.ev({ path: [], hands: [0], method: 'sampled', samples: 1000, seed: 5 }).json, big = S.ev({ path: [], hands: [0], method: 'sampled', samples: 16000, seed: 5 }).json;
  small.hands[0].stdErr.forEach((se, a) => { if (se > 0) { const r = se / big.hands[0].stdErr[a]; assert.ok(r > 2.5 && r < 6.5, 'SE ratio ' + r); } });
});
test('4.0 statistics: a non-significant difference is "differenceUncertain", never equivalence; equivalence needs an explicit margin (TOST)', { skip }, t => {
  const S = study(t, 'threeIcm', 800);
  const r = S.ev({ path: [], hands: [0, 1, 2, 3, 4, 5], method: 'sampled', samples: 200, seed: 2 }).json; let uncertain = 0;
  for (const h of r.hands) {
    if (!h.available) continue;
    assert.equal(h.classification[h.best], 'highestEstimate'); assert.equal(h.practicallyEquivalent, null, 'no margin, no equivalence claims');
    h.classification.forEach((c, a) => {
      if (a === h.best) return;
      assert.ok(['differenceSupported', 'differenceUncertain', 'insufficientSamples'].includes(c), c);
      assert.equal(h.equivalentToBest[a], false, 'equivalentToBest is never set from a non-significant difference');
      const [lo, hi] = h.vsBestCi95[a];
      if (c === 'differenceUncertain') { uncertain++; assert.ok(lo <= 0 && hi >= 0); assert.match(h.interpretation[a], /NOT evidence/); }
      if (c === 'differenceSupported') assert.ok(hi < 0);
    });
  }
  assert.ok(uncertain > 0, 'small samples leave some differences uncertain');
  assert.equal(r.statistics.equivalenceTest, null); assert.match(r.statistics.note, /never as equivalent/);
  // with a margin: wide -> equivalent, tiny -> not; insufficient samples are labelled
  const wide = S.ev({ path: [], hands: [0], method: 'sampled', samples: 4000, seed: 2, equivalenceMargin: 1000 }).json.hands[0];
  wide.classification.forEach((c, a) => { if (a !== wide.best) { assert.equal(c, 'practicallyEquivalent'); assert.equal(wide.equivalentToBest[a], true); } });
  const tiny = S.ev({ path: [], hands: [0], method: 'sampled', samples: 4000, seed: 2, equivalenceMargin: 1e-9 }).json.hands[0];
  tiny.classification.forEach((c, a) => { if (a !== tiny.best) assert.notEqual(c, 'practicallyEquivalent'); });
  const few = S.ev({ path: [], hands: [0], method: 'sampled', samples: 50, seed: 2, minSamples: 100 }).json.hands[0];
  few.classification.forEach((c, a) => { if (a !== few.best) assert.equal(c, 'insufficientSamples'); });
  // exact results: ties and margins are exact facts
  const ex = S.ev({ path: [], hands: [0], method: 'exact', equivalenceMargin: 1000 }).json.hands[0];
  ex.classification.forEach((c, a) => assert.ok(a === ex.best ? c === 'highest' : ['exactTie', 'withinMargin'].includes(c), c));
  const ex0 = S.ev({ path: [], hands: [0], method: 'exact' }).json.hands[0];
  ex0.classification.forEach((c, a) => assert.ok(a === ex0.best ? c === 'highest' : ['exactTie', 'lower'].includes(c), c));
});

// ============================== Priority 5: coverage and fallback ==============================
test('4.0 strategy coverage: untrained states are counted, probability-weighted and warned about; fallback policies and sensitivity are explicit', { skip }, t => {
  const short = study(t, 'threeSide', 3), long = study(t, 'huRiver', 3000);
  const a = short.ev({ path: [1], hands: [0, 1], method: 'exact' }).json;
  assert.ok(a.coverage.fallbackLookups > 0 && a.coverage.distinctFallbackInformationSets > 0);
  assert.ok(a.coverage.rowCoverage < 1 && a.coverage.rowCoverage >= 0);
  assert.ok(['notable', 'substantial'].includes(a.coverage.influence), a.coverage.influence); assert.match(a.coverage.warning, /fallback policy was substituted/);
  assert.equal(a.coverage.fallbackPolicy, 'uniform');
  const b = long.ev({ path: [], hands: [0], method: 'exact' }).json;
  assert.ok(b.coverage.policyLookups > 0); assert.ok(['none', 'minor'].includes(b.coverage.influence), b.coverage.influence + ' ' + b.coverage.maxActionFallbackShare);
  // levels follow the configured thresholds (influence = max(action share, opponent-reach share))
  for (const [warn, severe] of [[0, 0], [0.5, 0.9], [1, 1]]) {
    const c = short.ev({ path: [1], hands: [0], method: 'exact', fallbackWarnShare: warn, fallbackSevereShare: severe }).json.coverage;
    const x = Math.max(c.maxActionFallbackShare, c.maxOpponentReachFallbackShare);
    assert.equal(c.influence, x > 0 && x >= severe ? 'substantial' : x > 0 && x >= warn ? 'notable' : x > 0 ? 'minor' : 'none');
    assert.equal(c.warning === null, !['substantial', 'notable'].includes(c.influence));
  }
  // sampled: share of samples touched by a fallback
  const s = short.ev({ path: [1], hands: [0], method: 'sampled', samples: 500 }).json;
  assert.ok(s.coverage.samplesEvaluated > 0 && s.coverage.samplesWithFallback > 0 && s.coverage.sampleFallbackShare > 0);
  // alternative fallback policies change values where the strategy is missing; sensitivity is labelled
  const u = short.ev({ path: [1], hands: [0, 1], method: 'exact', fallback: 'uniform' }).json, f = short.ev({ path: [1], hands: [0, 1], method: 'exact', fallback: 'callCheck' }).json;
  assert.equal(f.coverage.fallbackPolicy, 'callCheck'); assert.notDeepEqual(u.hands.map(h => h.ev), f.hands.map(h => h.ev));
  const sens = short.ev({ path: [1], hands: [0, 1], method: 'exact', fallbackSensitivity: true }).json.fallbackSensitivity;
  assert.equal(sens.policies.length, 3); assert.match(sens.note, /not a confidence interval/); assert.equal(typeof sens.bestActionChanges, 'boolean');
  assert.deepEqual(sens.policies[0].hands.map(h => h.ev.slice(0, u.actions.length)), u.hands.map(h => h.ev));
  // refuse still refuses
  assert.match(short.ev({ path: [1], hands: [0], method: 'exact', missing: 'refuse' }).error, /error 422: Unavailable/);
});

// ============================== Priority 6: response evaluation ==============================
test('4.0 restricted best response: equals the exact best response on single-street studies, bounded by it on two streets, per seat on eight seats', { skip }, t => {
  for (const name of ['huRiver', 'threeSide', 'threeIcm']) {
    const S = study(t, name, 600), ex = S.gain({ method: 'exact' }).json, rs = S.gain({ method: 'restricted', selection: 'exact' }).json;
    assert.equal(rs.mode, 'restrictedBestResponse'); assert.equal(ex.mode, 'exactBestResponse');
    for (const s of rs.seats) {
      const e = ex.seats.find(x => x.seat === s.seat);
      assert.equal(s.selection, 'exact'); assert.ok(Math.abs(s.gain.mean - e.gain) < 1e-8 * Math.max(1, Math.abs(e.gain)), name + ' seat ' + s.seat + ' ' + s.gain.mean + ' vs ' + e.gain);
    }
  }
  const T = study(t, 'huTurn', 300), ex = T.gain({ method: 'exact' }).json, rs = T.gain({ method: 'restricted', selection: 'exact' }).json;
  for (const s of rs.seats) { const e = ex.seats.find(x => x.seat === s.seat); assert.ok(s.gain.mean <= e.gain + 1e-9 && s.gain.mean >= -1e-9, 'restricted ' + s.gain.mean + ' exact ' + e.gain); }
  // eight seats, sampled restricted response: every seat listed with its own uncertainty and timing
  const F = study(t, 'icmFinal', 20, 2), g = F.gain({ method: 'restricted', selection: 'sampled', selectionSamples: 16, samples: 300, maxNodes: 2, seed: 4 }).json;
  assert.equal(g.seats.length, 8); assert.equal(g.utility.model, 'icm'); assert.match(g.responseClass, /lower bound/);
  for (const s of g.seats) { assert.equal(s.mode, 'restrictedBestResponse'); assert.ok(s.available); assert.ok(Number.isFinite(s.gain.stdErr) && s.gain.samples >= 2); assert.ok(s.elapsedMs >= 0); }
  // reproducible seeds
  assert.deepEqual(F.gain({ method: 'restricted', selection: 'sampled', selectionSamples: 16, samples: 300, maxNodes: 2, seed: 4 }).json.seats.map(s => s.gain), g.seats.map(s => s.gain));
});

// ============================== Priority 2/12: background jobs and state integrity ==============================
async function json(r) { const text = await r.text(); try { return { http: r.status, ...JSON.parse(text) }; } catch { return { http: r.status, text }; } }
async function until(f, ms = 60000) { const t0 = Date.now(); for (;;) { const v = await f(); if (v) return v; if (Date.now() - t0 > ms) throw Error('timeout'); await new Promise(r => setTimeout(r, 10)); } }
async function trained(api, name, iterations) {
  assert.equal((await api('mw/init', JSON.stringify(E.MultiwayGame(studies[name]).nativeSpec()))).status, 200);
  assert.equal((await api('mw/train', { iterations, threads: 2 })).status, 200);
  await until(async () => !(await (await api('mw/status')).json()).running);
}
const stateBytes = async api => Buffer.from(await (await api('mw/state')).arrayBuffer());
test('4.0 desktop jobs: nonblocking explorer, progress, cancellation, timeouts, queueing, release, malformed requests and unchanged solver state', { skip }, async t => {
  await withHost(home(t), {}, async api => {
    assert.equal((await json(await api('mw/jobs/ev', { hands: [0] }))).http, 409, 'no study open');
    await trained(api, 'push8', 40);
    const before = await stateBytes(api);
    // malformed requests are rejected at submission and create no job
    for (const q of [{ hands: ['x'] }, { hands: [0], bogus: 1 }, { hands: [0], timeLimitMs: 5 }, { path: [9], hands: [0] }]) assert.equal((await json(await api('mw/jobs/ev', q))).http, 400, JSON.stringify(q));
    assert.equal((await json(await api('mw/jobs/ev', '{"hands":[0],'))).http, 400);
    assert.equal((await json(await api('mw/jobs/response-gain', { method: 'magic' }))).http, 400);
    assert.equal((await json(await api('mw/jobs/ev', { hands: [0], memoryMiB: 4096 }))).http, 413, 'memory budget above the pool');
    assert.equal((await json(await api('mw/jobs'))).jobs.length, 0);
    assert.equal((await json(await api('mw/jobs/config', { workers: 0 }))).http, 400);
    assert.equal((await json(await api('mw/jobs/config', { workers: 1, threadsPerJob: 2 }))).workers, 1);
    // a long exact job runs in the background
    const big = { path: [], hands: [0], method: 'exact', maxVisits: 2000000000, timeLimitMs: 600000 };
    const a = await json(await api('mw/jobs/ev', big)); assert.equal(a.http, 202); assert.match(a.jobId, /^ev-[0-9a-f]{8}-\d+$/);
    const b = await json(await api('mw/jobs/ev', { ...big, path: [1, 1] })); assert.equal(b.status, 'pending');
    await until(async () => (await json(await api('mw/jobs/' + a.jobId))).status === 'running');
    // lightweight requests still answer while it runs
    for (const [route, body] of [['mw/node', { path: [1], limit: 3 }], ['mw/status'], ['mw/jobs'], ['memory'], ['checkpoint/status']]) {
      const t0 = Date.now(); const r = await api(route, body); assert.ok(r.status < 500, route); await r.arrayBuffer(); assert.ok(Date.now() - t0 < 1000, route + ' took ' + (Date.now() - t0) + ' ms');
    }
    const sync = await json(await api('mw/ev', { path: [1, 1, 1], hands: [0], method: 'exact', maxVisits: 2000000000, timeLimitMs: 60000 })); assert.equal(sync.http, 200, 'small synchronous EVs run concurrently');
    // mutations are refused while evaluations read the study
    for (const [route, body] of [['mw/train', { iterations: 5, threads: 1 }], ['mw/free', {}], ['mw/import', 'x']]) assert.equal((await api(route, body)).status, 409, route);
    const running = await json(await api('mw/jobs/' + a.jobId)); assert.equal(running.status, 'running'); assert.ok(running.progress.visits > 0); assert.ok(typeof running.progress.stage === 'string');
    assert.equal(b.status, 'pending'); assert.equal((await json(await api('mw/jobs/' + b.jobId))).status, 'pending', 'one worker: the second job waits');
    // cancellation
    const c0 = Date.now(); await api('mw/jobs/' + a.jobId + '/cancel', {});
    const done = await until(async () => { const j = await json(await api('mw/jobs/' + a.jobId)); return j.status !== 'running' && j; });
    assert.equal(done.status, 'cancelled'); assert.ok(Date.now() - c0 < 1000, 'cancelled in ' + (Date.now() - c0) + ' ms'); assert.equal((await json(await api('mw/jobs/' + a.jobId + '/result'))).http, 409);
    // the queued job now runs to completion and equals the synchronous result
    const bd = await until(async () => { const j = await json(await api('mw/jobs/' + b.jobId)); return ['completed', 'failed'].includes(j.status) && j; }, 120000);
    assert.equal(bd.status, 'completed', bd.error); const res = await json(await api('mw/jobs/' + b.jobId + '/result'));
    const ref = await json(await api('mw/ev', { ...big, path: [1, 1] })); assert.deepEqual(res.hands, ref.hands);
    // timeouts are reported as such, with no result
    const to = await json(await api('mw/jobs/ev', { ...big, timeLimitMs: 150 }));
    const tod = await until(async () => { const j = await json(await api('mw/jobs/' + to.jobId)); return ['timedOut', 'failed', 'completed'].includes(j.status) && j; });
    assert.equal(tod.status, 'timedOut'); assert.equal(tod.httpStatus, 408); assert.ok(tod.runningMs < 150 + TOLERANCE_MS, String(tod.runningMs));
    // pending jobs can be cancelled; release frees finished jobs; running/pending jobs cannot be released
    const p1 = await json(await api('mw/jobs/ev', big)), p2 = await json(await api('mw/jobs/ev', big));
    assert.equal((await api('mw/jobs/' + p2.jobId + '/release', {})).status, 409);
    await api('mw/jobs/' + p2.jobId + '/cancel', {}); assert.equal((await json(await api('mw/jobs/' + p2.jobId))).status, 'cancelled');
    await api('mw/jobs/' + p1.jobId + '/cancel', {}); await until(async () => (await json(await api('mw/jobs/' + p1.jobId))).status === 'cancelled');
    for (const id of [a.jobId, b.jobId, to.jobId, p1.jobId, p2.jobId]) assert.equal((await api('mw/jobs/' + id + '/release', {})).status, 200);
    assert.equal((await api('mw/jobs/' + a.jobId)).status, 404); assert.equal((await api('mw/jobs/..%2f')).status, 404);
    // a response-gain job
    const g = await json(await api('mw/jobs/response-gain', { method: 'sampled', samples: 200 }));
    const gd = await until(async () => { const j = await json(await api('mw/jobs/' + g.jobId)); return j.status === 'completed' && j; });
    assert.equal((await json(await api('mw/jobs/' + gd.jobId + '/result'))).seats.length, 8);
    // nothing an evaluation did changed the solver state
    assert.ok(before.equals(await stateBytes(api)), 'state bytes unchanged by completed, cancelled and timed-out evaluations');
    assert.equal((await api('mw/train', { iterations: 5, threads: 1 })).status, 200, 'training is allowed again once no evaluation reads the study');
  });
});
test('4.0 desktop jobs: worker start failure is reported and recovers; worker threads stay bounded', { skip }, async t => {
  await withHost(home(t), { EIGHTMAX_TEST_FAIL_EV_WORKER: '1' }, async (api) => {
    await trained(api, 'huRiver', 300);
    const first = await json(await api('mw/jobs/ev', { path: [], hands: [0], method: 'exact' })); assert.equal(first.http, 503); assert.match(first.error, /worker/);
    assert.equal((await json(await api('mw/jobs'))).jobs.length, 0, 'a failed start leaves no job behind');
    const ids = []; for (let i = 0; i < 6; i++) ids.push((await json(await api('mw/jobs/ev', { path: [], hands: [i % 4], method: 'sampled', samples: 2000, seed: i }))).jobId);
    for (const id of ids) await until(async () => (await json(await api('mw/jobs/' + id))).status === 'completed');
    const cfg = (await json(await api('mw/jobs'))).config; assert.ok(cfg.workersStarted <= cfg.workers, JSON.stringify(cfg)); assert.equal(cfg.workerStartFailures, 1); assert.equal(cfg.running, 0); assert.equal(cfg.runningMiB, 0);
  });
});
test('4.0 evaluations between training runs do not change deterministic continuation (state equals uninterrupted training)', { skip }, async t => {
  let plain, withJobs;
  await withHost(home(t), {}, async api => { await trained(api, 'huRiver', 200); assert.equal((await api('mw/train', { iterations: 200, threads: 2 })).status, 200); await until(async () => !(await (await api('mw/status')).json()).running); plain = await stateBytes(api); });
  await withHost(home(t), {}, async api => {
    await trained(api, 'huRiver', 200);
    for (const q of [{ path: [], hands: [0, 1], method: 'exact' }, { path: [], hands: [0], method: 'sampled', samples: 3000 }]) { const j = await json(await api('mw/jobs/ev', q)); await until(async () => (await json(await api('mw/jobs/' + j.jobId))).status === 'completed'); }
    const c = await json(await api('mw/jobs/response-gain', { method: 'exact', timeLimitMs: 100000 })); await until(async () => ['completed', 'failed'].includes((await json(await api('mw/jobs/' + c.jobId))).status));
    assert.equal((await api('mw/train', { iterations: 200, threads: 2 })).status, 200); await until(async () => !(await (await api('mw/status')).json()).running);
    withJobs = await stateBytes(api);
  });
  assert.ok(plain.equals(withJobs), 'regrets, averages, betting states, RNG and counters are identical');
});

// ============================== Priority 11: eight-handed accounting ==============================
test('4.0 eight-handed default structure: 0.5/1 blinds, 0.1 BB ante per dealt player, 2.3 BB initial pot; short stacks and side pots conserve chips', { skip }, t => {
  const g = E.MultiwayGame({ ...base, preflop: { mode: 'linked', opens: '2.2,a', raises: 'a', maxBets: 2 }, board: '', dealt: 8, common: 0, stacks: Array(8).fill(40), ranges: Array(8).fill('random'), streets: { flop: { bets: '50', raises: '', maxBets: 1 }, turn: { bets: 'a', raises: '', maxBets: 1 }, river: { bets: 'a', raises: '', maxBets: 1 } } });
  const spec = g.nativeSpec();
  assert.deepEqual(spec.anteOf, Array(8).fill(0.1)); assert.ok(Math.abs(spec.anteOf.reduce((a, b) => a + b, 0) - 0.8) < 1e-12);
  const S = study(t, 'icmFinal', 5, 2), root = S.node({ limit: 1 });
  assert.ok(Math.abs(root.node.pot - 2.3) < 1e-9, 'initial pot ' + root.node.pot);
  assert.deepEqual(root.history.length, 0); assert.equal(root.node.actor, 0, 'UTG acts first');
  // short stack (9 BB, seat 4) all-in against bigger stacks: walk to terminals and check pot layers
  const P = study(t, 'push8chip', 5, 2); let checked = 0;
  const walk = (p, depth) => {
    const q = P.node({ path: p, limit: 1 }); if (!q || depth > 9) return;
    if (q.node.kind === 'terminal') {
      const committed = q.node.committed.reduce((a, b) => a + b, 0) + 0.8, pots = q.node.pots.reduce((a, x) => a + x.amount, 0);
      assert.ok(Math.abs(committed - pots) < 1e-9, 'chips conserved at ' + p + ': ' + committed + ' vs ' + pots);
      for (let i = 1; i < q.node.pots.length; i++) assert.ok(q.node.pots[i].eligible.every(s => q.node.pots[i - 1].eligible.includes(s)), 'side pots are nested');
      checked++; return;
    }
    for (let a = 0; a < q.actions.length; a++) walk([...p, a], depth + 1);
  };
  walk([1, 1, 1, 1], 0); assert.ok(checked >= 8, 'terminals checked ' + checked);
});
test('4.0 ICM reference: Malmuth-Harville equity of a three-player final table equals a hand calculation; chip EV utilities conserve chips', () => {
  // stacks 50/30/20, payouts 50/30/20: P(1st)=s_i/100; P(2nd|j first)=s_i/(100-s_j)
  const s = [50, 30, 20], pay = [50, 30, 20], eq = [0, 0, 0];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (j !== i) for (let k = 0; k < 3; k++) if (k !== i && k !== j) { const p = s[i] / 100 * s[j] / (100 - s[i]); eq[i] += p * pay[0]; eq[j] += p * pay[1]; eq[k] += p * pay[2]; }
  const icm = E.icmWithBusts(s, s, pay); for (let i = 0; i < 3; i++) assert.ok(Math.abs(icm[i] - eq[i]) < 1e-9, icm[i] + ' vs ' + eq[i]);
  assert.ok(Math.abs(icm.reduce((a, b) => a + b, 0) - 100) < 1e-9);
});

// ============================== Priority 4/5/14: explorer presentation ==============================
test('4.0 explorer shows classifications, uncertainty, coverage warnings and job status without claiming equivalence from overlap', () => {
  const resp = { study: { players: 2, startStreet: 'river', abstraction: 'exact cards', weighting: 'linear', regretMatching: 'standard', tournament: true, updates: 1, sampledDeals: 1, rows: 1, states: 1 },
    node: { kind: 'decision', street: 'river', stateId: 0, visited: true, actor: 0, facing: false, price: 0, pot: 10, behind: [10, 10], live: [true, true], allIn: [false, false], effectiveStack: 10, board: [48, 49, 0, 4, 8] },
    history: [], actions: [{ slot: 0, name: 'Check', to: 0 }, { slot: 1, name: 'Bet to', to: 5 }], ev: { available: false, reason: 'none' },
    hands: { seat: 0, actingSeat: true, total: 1, offset: 0, items: [{ i: 0, cards: [50, 51], weight: 1, blocked: false, reach: 1, average: [0.25, 0.75], current: [0, 1] }] },
    aggregate: { rangeMass: 1, average: [0.25, 0.75], current: [0, 1], coverage: { hands: 1, blocked: 0, withRows: 1 } } };
  const hand = { i: 0, cards: [50, 51], available: true, method: 'sampled', samples: 1000, ev: [1.5, 1.52], stdErr: [0.1, 0.2], ci95: [[1.3, 1.7], [1.1, 1.9]], mixed: 1.51, mixedStdErr: 0.1, diff: [-0.01, 0.01], diffStdErr: [0, 0], best: 1,
    vsBest: [-0.02, 0], vsBestCi95: [[-0.3, 0.26], [0, 0]], classification: ['differenceUncertain', 'highestEstimate'], interpretation: ['difference not established: the 95% interval of the paired difference includes zero. This is NOT evidence that the EVs are equal', 'highest EV'],
    equivalentToBest: [false, true], fallbackShare: [0.6, 0.5], strategy: [0.25, 0.75], reach: 1 };
  const ev = { method: 'sampled', status: 'partial', stoppedEarly: true, policy: 'average', utility: { model: 'icm', unit: 'payout units', convention: 'x' }, actions: resp.actions, futureActions: 'enumerated', seed: 1, samplesRequested: 1000, threads: 4, execution: { device: 'auto', gpuBoards: 0 },
    coverage: { rowCoverage: 0.5, policyLookups: 10, distinctFallbackInformationSets: 2, maxActionFallbackShare: 0.6, maxOpponentReachFallbackShare: 0.1, fallbackPolicy: 'uniform', fallbackDescription: 'uniform over the legal actions', warning: 'Up to 60.0% of the probability mass ...' },
    statistics: { equivalenceMargin: null }, hands: [hand], range: null };
  const html = E.renderExplorer(resp, { kind: 'average', ev, evJob: { jobId: 'ev-1', status: 'running', progress: { elapsedMs: 1500, samples: 300, stage: 'sampled evaluation' } }, selectedCell: E.classOf(50, 51) });
  for (const re of [/difference uncertain/, /NOT evidence/, /⚠ Up to 60\.0%/, /PARTIAL/, /Job ev-1: running/, /data-ex-ev="cancel"/, /300 samples/, /ex-ev-method/, /ex-ev-time/, /ex-ev-visits/, /ex-ev-device/, /Hybrid CPU\/GPU/, /ex-ev-margin/, /ex-ev-fallback/, /Chip EV/, /95% interval -0\.300 to 0\.260/]) assert.match(html, re);
  assert.doesNotMatch(html, /not significantly different|equal to the best/, 'no equivalence wording from overlapping intervals');
  assert.doesNotMatch(html, /\d+(\.\d+)?% complete/, 'no unsupported progress percentage');
  // with a margin and a supported equivalence the label says so explicitly
  const eq = { ...ev, statistics: { equivalenceMargin: 0.5 }, hands: [{ ...hand, classification: ['practicallyEquivalent', 'highestEstimate'], interpretation: ['practically equivalent: ...', 'highest EV'] }] };
  assert.match(E.renderExplorer(resp, { kind: 'average', ev: eq, selectedCell: E.classOf(50, 51) }), /equivalent within margin[\s\S]*margin 0\.500 payout units/);
  // a 3.9 result without classifications makes no equivalence claim either
  const old = { ...ev, coverage: undefined, hands: [{ ...hand, classification: undefined, interpretation: undefined }] };
  assert.match(E.renderExplorer(resp, { kind: 'average', ev: old, selectedCell: E.classOf(50, 51) }), /makes no equivalence claim/);
});
