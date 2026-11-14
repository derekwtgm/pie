'use strict';
// EightMax 4.6 regression tests.
//
// Priority 1 (release blocker) - Windows checkpoint continuation. The 4.5 self-test on the
//   target PC stopped with "icm45b.state does not exist" because the script discarded
//   mwcli's output and exit codes. mwcli now reports why a continuation or save failed
//   (exit 3: input checkpoint unreadable; 4: save failed, with the failing stage and OS
//   error) and runs a self-recording continuation suite (--continuation-suite) in
//   separate processes. These tests run the suite and the failure paths.
// Priority 3 - process-wide memory ledger of the desktop host (native/em_ledger.h):
//   tables, restore, synchronous evaluations and background jobs reserve from one
//   budget; refusals leave the solver state untouched and leak no reservation.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
const E = require('../tools/loadlib');
for (const l of ['lib_runouts', 'lib_wide', 'lib_river', 'lib_pushfold', 'lib_explorer']) require('../web/' + l);
const { withHost, home } = require('./checkpoint_host');
const build = require('./native_build');
const tool = () => process.env.EM_TEST_MWCLI || build.cli().cli;
const skip = !tool() && (build.cli().why || 'no native CLI');
const hostSkip = !(process.env.EM_TEST_HOST || build.host().exe) && 'native host unavailable';
const spec45 = path.join(__dirname, '..', '..', 'validation', '4.5', 'fixtures', 'icm-final8.spec.json');
const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'em46-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const sha = f => require('node:crypto').createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const GOLDEN_300 = 'aa80974199182afa91d5a47166d32af0eb00ecff3ba334593eb5a359cc2e22b8';   // 4.4/4.5 golden state, 300 updates
const cli = (args, env = {}) => cp.spawnSync(tool(), args.map(String), { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 600000, maxBuffer: 1 << 28 });

test('4.6 continuation suite: 150+150, 500+500, 1000+1000, generations, re-saves, threads, interrupted saves, cancellation, bad inputs', { skip, timeout: 900000 }, t => {
  const dir = tmp(t), work = path.join(dir, 'work with space');
  const r = cli(['--continuation-suite', spec45, work, 'standard', 4]);
  assert.ok(fs.existsSync(path.join(work, 'continuation-suite.json')), 'the suite writes its evidence file even before the verdict');
  const rep = JSON.parse(fs.readFileSync(path.join(work, 'continuation-suite.json'), 'utf8'));
  const failed = rep.checks.filter(c => !c.passed);
  assert.equal(r.status, 0, 'failed checks: ' + JSON.stringify(failed, null, 1));
  assert.equal(rep.checksFailed, 0); assert.ok(rep.checksPassed >= 25, 'checks run: ' + rep.checksPassed);
  // every recorded process carries the diagnostic fields the 4.5 script lacked
  for (const s of rep.steps.filter(s => s.kind === 'train')) for (const k of ['command', 'workingDirectory', 'exitCode', 'stdout', 'stderr', 'ms', 'output']) assert.ok(k in s, s.label + ' lacks ' + k);
  assert.equal(sha(path.join(work, 'icm45-direct.state')), GOLDEN_300, 'the uninterrupted 300-update state equals the 4.4/4.5 golden bytes');
  assert.equal(sha(path.join(work, 'icm45-b.state')), GOLDEN_300, 'the resumed state (the 4.5 failing step) equals the golden bytes');
});

test('4.6 state-info: header counters, RNG and SHA-256 equal an independent hash', { skip, timeout: 300000 }, t => {
  const dir = tmp(t), st = path.join(dir, 's.state');
  assert.equal(cli([spec45, 150, 2, st, 512]).status, 0);
  const r = cli(['--state-info', st]); assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout).state;
  assert.equal(j.sha256, sha(st)); assert.equal(j.header.iterations, 150); assert.equal(j.header.trainingDeals, 600);
  for (const k of ['rng', 'actionRng', 'stateVisits', 'rowCrc32', 'studyId']) assert.ok(k in j.header, k);
  const missing = cli(['--state-info', path.join(dir, 'none.state')]); assert.notEqual(missing.status, 0); assert.equal(JSON.parse(missing.stdout).state.exists, false);
});

test('4.6 training exit codes: missing input (3), unreadable path names the file, failed save (4) keeps the previous checkpoint', { skip, timeout: 300000 }, t => {
  const dir = tmp(t), st = path.join(dir, 'a.state'), keep = path.join(dir, 'keep.state');
  assert.equal(cli([spec45, 20, 2, st, 512]).status, 0);
  const miss = cli([spec45, 5, 2, path.join(dir, 'out.state'), 512, path.join(dir, 'missing.state')]);
  assert.equal(miss.status, 3); assert.match(miss.stderr, /missing\.state/); assert.ok(!fs.existsSync(path.join(dir, 'out.state')));
  fs.copyFileSync(st, keep); const before = sha(keep);
  for (const [fault, stage] of [['create', 'injected-create'], ['write', 'injected-write'], ['flush', 'injected-flush'], ['rename', 'injected-replace']]) {
    const r = cli([spec45, 5, 2, keep, 512, st], { EM_TEST_SAVE_FAULT: fault });
    assert.equal(r.status, 4, fault + ': ' + r.stderr); assert.match(r.stderr, new RegExp("stage '" + stage + "'")); assert.match(r.stderr, /previous file .* unchanged/);
    assert.equal(sha(keep), before, fault + ': the previous checkpoint is unchanged');
    assert.deepEqual(fs.readdirSync(dir).filter(n => n.startsWith('keep.state.')), [], fault + ': no temporary file left');
  }
  // a crash after the temporary file is complete but before the replace (power loss / kill)
  const c = cli([spec45, 5, 2, keep, 512, st], { EM_TEST_SAVE_FAULT: 'crash' });
  assert.equal(c.status, 86); assert.equal(sha(keep), before);
  // the next save of the same name works and is identical to a run that never failed
  assert.equal(cli([spec45, 5, 2, keep, 512, st]).status, 0);
  assert.equal(cli([spec45, 25, 2, path.join(dir, 'ref.state'), 512]).status, 0);
  assert.equal(sha(keep), sha(path.join(dir, 'ref.state')));
});

test('4.6 cancelled training keeps exactly the committed updates (no partial update)', { skip, timeout: 300000 }, t => {
  const dir = tmp(t), a = path.join(dir, 'a.state'), c = path.join(dir, 'c.state'), ref = path.join(dir, 'r.state');
  assert.equal(cli([spec45, 50, 4, a, 512]).status, 0);
  const r = cli([spec45, 5000000, 4, c, 512, a], { EM_TRAIN_CANCEL_AFTER_MS: 250 }); assert.equal(r.status, 0, r.stderr);
  const info = JSON.parse(r.stdout); assert.equal(info.cancelled, true); assert.ok(info.iterations > 50 && info.iterations < 5000050);
  assert.equal(cli([spec45, info.iterations - 50, 4, ref, 512, a]).status, 0);
  assert.equal(sha(c), sha(ref), 'cancelled at ' + info.iterations + ' updates');
});

// ---------------- process-wide memory ledger ----------------
const jsonOf = async r => ({ http: r.status, ...(await r.json().catch(() => ({}))) });
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 120000) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw Error('timed out'); await pause(50); } }
const STACKS8 = [30, 22, 15, 40, 9, 18, 25, 12], PAY8 = [30, 20, 14, 11, 9, 7, 5, 4];
const pushSpec = () => E.MultiwayGame({ privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128, preflop: { mode: 'shove' }, board: '', dealt: 8, common: 0, stacks: STACKS8, ranges: ['AsAh', 'KsKh', 'QsQh', 'JsJh', 'TsTh', '9s9h', '8s8h', '7s7h'], icm: { payouts: PAY8 }, batchDeals: 4, actionStreams: 'deal', privateSeed: 4 }).nativeSpec();
const mem = async api => jsonOf(await api('mw/memory'));
async function trainTo(api, n) { assert.equal((await api('mw/train', { iterations: n, threads: 2 })).status, 200); await until(async () => !(await (await api('mw/status')).json()).running); }

test('4.6 memory ledger: report, table reservation, refusal of an oversized evaluation without side effects', { skip: hostSkip, timeout: 300000 }, async t => {
  await withHost(home(t), { EIGHTMAX_LEDGER_MIB: '1000' }, async api => {
    let m = await mem(api);
    assert.equal(m.http, 200); assert.equal(m.budgetMiB, 1000); assert.equal(m.reservedMiB, 0); assert.ok(m.process.residentMiB > 0 && m.process.peakResidentMiB >= m.process.residentMiB);
    for (const k of ['tables', 'restore', 'eval', 'jobs']) assert.ok(k in m.kinds, k);
    const spec = { ...pushSpec(), tableLimitMiB: 300 };
    const init = await jsonOf(await api('mw/init', JSON.stringify(spec))); assert.equal(init.http, 200, init.error);
    m = await mem(api); assert.equal(m.kinds.tables.reservedMiB, Math.ceil(init.budgetMiB)); assert.ok(m.reservedMiB <= 300);
    await trainTo(api, 60);
    const before = Buffer.from(await (await api('mw/state')).arrayBuffer());
    // 300 tables + 576 (512 + 64 default coverage) fits in 1000
    const ok = await jsonOf(await api('mw/ev', { hands: [0], method: 'sampled', samples: 300, seed: 1, path: [] })); assert.equal(ok.http, 200, ok.error);
    // 300 + 1024 + 64 does not: refused before anything is allocated
    const big = await jsonOf(await api('mw/ev', { hands: [0], method: 'sampled', samples: 300, seed: 2, path: [], memoryMiB: 1024 }));
    assert.equal(big.http, 503); assert.match(big.error, /Process memory budget: eval: 1088 MiB requested/);
    const gain = await jsonOf(await api('mw/response-gain', { method: 'sampled', samples: 50, memoryMiB: 2048 })); assert.equal(gain.http, 503);
    m = await mem(api);
    assert.equal(m.kinds.eval.reservedMiB, 0, 'no evaluation reservation leaked'); assert.equal(m.kinds.eval.refusals, 2); assert.ok(m.peakReservedMiB <= m.budgetMiB); assert.equal(m.withinBudget, true);
    assert.ok(Buffer.from(await (await api('mw/state')).arrayBuffer()).equals(before), 'the refused requests left the study unchanged');
    // the study keeps training after the refusals; free releases the table reservation
    await trainTo(api, 20);
    assert.equal((await api('mw/free', {})).status, 200); m = await mem(api); assert.equal(m.reservedMiB, 0);
  });
});

test('4.6 memory ledger: refused evaluations do not change training (resumed bytes == uninterrupted bytes)', { skip: hostSkip, timeout: 300000 }, async t => {
  const states = [];
  for (const interrupt of [true, false]) await withHost(home(t), { EIGHTMAX_LEDGER_MIB: '700' }, async api => {
    assert.equal((await api('mw/init', JSON.stringify({ ...pushSpec(), tableLimitMiB: 200 }))).status, 200);
    if (interrupt) {
      await trainTo(api, 40);
      for (let i = 0; i < 3; i++) assert.equal((await api('mw/ev', { hands: [0], method: 'sampled', samples: 100, seed: i, path: [], memoryMiB: 1024 })).status, 503);
      await trainTo(api, 40);
    } else await trainTo(api, 80);
    states.push(Buffer.from(await (await api('mw/state')).arrayBuffer()));
  });
  assert.ok(states[0].length > 0 && states[0].equals(states[1]));
});

test('4.6 memory ledger: background jobs wait for room, oversized jobs are refused, concurrent requests never exceed the budget', { skip: hostSkip, timeout: 300000 }, async t => {
  await withHost(home(t), { EIGHTMAX_LEDGER_MIB: '1500' }, async api => {
    assert.equal((await api('mw/init', JSON.stringify({ ...pushSpec(), tableLimitMiB: 300 }))).status, 200);
    await trainTo(api, 60);
    const huge = await jsonOf(await api('mw/jobs/ev', { hands: [0], method: 'sampled', samples: 100, path: [], memoryMiB: 4000, coverageMiB: 64 }));
    assert.equal(huge.http, 413); assert.match(huge.error, /process memory budget/);
    // two jobs of 664 MiB: 300 + 664 + 664 > 1500, so the second waits until the first finishes
    const q = s => ({ hands: [0], method: 'sampled', samples: 200000, seed: s, path: [], memoryMiB: 600, coverageMiB: 64, timeLimitMs: 1500 });
    const a = await jsonOf(await api('mw/jobs/ev', q(1))), b = await jsonOf(await api('mw/jobs/ev', q(2)));
    assert.equal(a.http, 202, a.error); assert.equal(b.http, 202, b.error);
    let sawWaiting = false;
    const done = await until(async () => {
      const sa = await jsonOf(await api('mw/jobs/' + a.jobId)), sb = await jsonOf(await api('mw/jobs/' + b.jobId));
      if (sa.status === 'running' && sb.status === 'pending') sawWaiting = true;
      const m = await mem(api); assert.ok(m.reservedMiB <= m.budgetMiB);
      return ['completed', 'timedOut', 'failed', 'cancelled'].includes(sa.status) && ['completed', 'timedOut', 'failed', 'cancelled'].includes(sb.status) && [sa, sb];
    });
    assert.ok(sawWaiting, 'the second job waited for the first one\'s memory');
    for (const s of done) assert.equal(s.status, 'completed', JSON.stringify(s));
    let m = await mem(api); assert.equal(m.kinds.jobs.reservedMiB, 0); assert.ok(m.kinds.jobs.peakMiB <= 664 + 0, 'never both jobs at once');
    // eight simultaneous synchronous evaluations of 576 MiB: at most two fit beside the tables
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => api('mw/ev', { hands: [0], method: 'sampled', samples: 20000, seed: 100 + i, path: [] }).then(jsonOf)));
    const codes = rs.map(r => r.http);
    assert.ok(codes.every(c => c === 200 || c === 503) && codes.includes(200), codes.join(','));
    m = await mem(api); assert.equal(m.kinds.eval.reservedMiB, 0); assert.ok(m.kinds.eval.peakMiB <= 2 * 576, 'peak ' + m.kinds.eval.peakMiB); assert.ok(m.peakReservedMiB <= m.budgetMiB);
    for (const id of [a.jobId, b.jobId]) await api('mw/jobs/' + id + '/release', {});
  });
});

test('4.6 memory ledger: a restore that does not fit fails without touching the open study; it fits after the study is closed', { skip: hostSkip, timeout: 300000 }, async t => {
  const fixture = path.join(__dirname, '..', '..', 'validation', '3.7', 'fixtures', 'eight-seat-3.6.emstudy');
  await withHost(home(t), { EIGHTMAX_LEDGER_MIB: '400' }, async (api, url) => {
    assert.equal((await api('mw/init', JSON.stringify({ ...pushSpec(), tableLimitMiB: 400 }))).status, 200);
    await trainTo(api, 30);
    const before = Buffer.from(await (await api('mw/state')).arrayBuffer());
    const up = await fetch(url + '/api/checkpoint/native-upload', { method: 'POST', headers: { 'X-EightMax': '1' }, body: fs.readFileSync(fixture) });
    assert.notEqual(up.status, 200, 'with no MiB free the restore cannot start');
    let m = await mem(api); assert.equal(m.kinds.restore.reservedMiB, 0, 'the restore reservation was released');
    assert.ok(Buffer.from(await (await api('mw/state')).arrayBuffer()).equals(before), 'the open study is unchanged');
    assert.equal((await api('mw/free', {})).status, 200);
    const ok = await fetch(url + '/api/checkpoint/native-upload', { method: 'POST', headers: { 'X-EightMax': '1' }, body: fs.readFileSync(fixture) });
    assert.equal(ok.status, 200, await ok.text());
    m = await mem(api); assert.equal(m.kinds.restore.reservedMiB, 0); assert.ok(m.kinds.tables.reservedMiB > 0 && m.kinds.tables.reservedMiB <= 400, 'the restored study holds the table reservation');
    assert.equal((await (await api('mw/status')).json()).engine.iterations, 8);
  });
});

// ---------------- Automatic scheduling (cold process) ----------------
// The 4.5 hardware report listed cold Automatic as 21% slower than CPU-only for eight-seat
// exact gains (medians of 3 non-interleaved runs: 33.5 vs 27.7 ms; Automatic's own fastest
// run, 18.0 ms, beat every CPU run). In a cold process Automatic keeps the first tables on the
// CPU and never touches the CUDA driver (no open, no background open), so the work is the
// CPU-only work; results are bit-identical. validate_hardware.ps1 now interleaves the modes.
test('4.6 cold Automatic: CPU path without any CUDA activity, bit-identical to CPU-only', { skip, timeout: 300000 }, t => {
  const dir = tmp(t), fx = path.join(__dirname, '..', '..', 'validation', '4.0', 'fixtures');
  const run = (mode, body) => { const q = path.join(dir, 'q.json'); fs.writeFileSync(q, JSON.stringify(body)); const r = cli([mode, path.join(fx, 'push8-icm.spec.json'), path.join(fx, 'push8-icm.state'), q]); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };
  for (const [mode, body, bits] of [['--gain', { method: 'exact', seats: [0, 1, 2, 3, 4, 5, 6, 7], threads: 4 }, r => r.seats.map(s => s.gainBits).join()], ['--ev', { path: [], hands: [0], method: 'exact', maxVisits: 2000000000, threads: 4 }, r => r.hands[0].evBits.join()]]) {
    const cpu = run(mode, { ...body, device: 'cpu' }), auto = run(mode, { ...body, device: 'auto' });
    const e = auto.execution;
    assert.equal(e.observedDevice, 'cpu'); assert.equal(e.gpuBoards, 0); assert.equal(e.cpuBoards, cpu.execution.cpuBoards);
    assert.equal(e.cuda.attempted, false); assert.equal(e.cuda.opens, 0); assert.equal(e.cuda.backgroundOpens, 0); assert.equal(e.scheduling.gpuBackgroundOpens, 0);
    assert.ok(e.scheduling.cpuGpuWarmup >= 1, 'decided as warm-up (CPU) table');
    assert.equal(bits(auto), bits(cpu));
  }
});

// ---------------- multiway postflop and ICM invariants (Priority 8 / 9) ----------------
// For every game: (1) an exact unilateral best response can never be worse than the policy,
// so every exact gain is >= 0 (up to rounding); (2) NashConv is the sum of the gains;
// (3) value is conserved: the sum over seats of the policy values is the same for two
// different strategies (a weakly and a longer trained one) - chips (chip EV) or the prize pool
// (ICM) are neither created nor destroyed by side pots, all-ins or blockers; (4) exact
// response gains are bit-identical for 1, 2, 4, 8, 16 and 24 evaluation threads;
// (5) two-player chip EV reports exploitability = NashConv / 2, all other games report none.
const mwBase = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128 };
const games46 = {
  'five-player flop, weighted ranges, two bet sizes, side pots': { board: 'Td7c2h', dealt: 7, common: 1.5, stacks: [20, 35, 8, 50, 14], prior: Array(5).fill(2.5), folded: [1, 2.5], ranges: ['AhTh,7s7d:0.5', 'KdTs,9c8c', 'QsQd:0.75,Ac7h', 'JhTc,6s5s', 'AdKc,2s2d'], streets: { flop: { bets: '50,a', raises: '', maxBets: 1 } } },
  'four-player turn and river, unequal stacks': { board: 'Ks8d5h2c', dealt: 6, common: 2, stacks: [6, 18, 30, 12], ranges: ['AhKh,KdQd', 'AsKd,5d5c', 'Kc9c,QsQc', 'Ah5s,JhJc'], streets: { turn: { bets: 'a', raises: '', maxBets: 1 }, river: { bets: '50', raises: '', maxBets: 1 } } },
  'three-player river, three bet sizes and raises': { board: 'Ks8d5h2c2s', common: 6, stacks: [4, 12, 30], ranges: ['AhKh,KdQd,8s8h', 'AsKd,KcJc,5d5c', 'Kc9c,QsQc,7d7c'], streets: { river: { bets: '33,75,a', raises: 'a', maxBets: 2 } } },
  'multiway short-stack all-ins, bubble ICM': { preflop: { mode: 'shove' }, dealt: 4, common: 0, board: '', stacks: [2, 30, 5, 40], ranges: ['AsAh,7c2d:0.5', 'KsKh:0.75,8c3d', 'QsQh,6d5d', 'JsJh:0.5,9s8s'], icm: { payouts: [50, 30, 20] }, batchDeals: 4, actionStreams: 'deal' },
  'heads-up river, chip EV': { board: 'Ks8d5h2c2s', common: 10, stacks: [20, 20], ranges: ['AhKh,KdQd,8s8h,JsTs', 'AsKd,KcJc,5d5c,8h7h'], streets: { river: { bets: '50,a', raises: 'a', maxBets: 2 } } },
};
for (const [name, cfg] of Object.entries(games46)) test('4.6 invariants: ' + name, { skip, timeout: 600000 }, t => {
  const dir = tmp(t), spec = path.join(dir, 'spec.json'), q = path.join(dir, 'q.json');
  const game = E.MultiwayGame({ ...mwBase, ...cfg, privateSeed: 7 }); const n = game.nativeSpec().n;
  fs.writeFileSync(spec, JSON.stringify(game.nativeSpec()));
  const gainsAt = (state, threads) => { fs.writeFileSync(q, JSON.stringify({ method: 'exact', threads, timeLimitMs: 3600000, maxVisits: 2000000000 })); const r = cli(['--gain', spec, state, q]); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };
  const totals = [];
  for (const deals of [2000, 20000]) {
    const st = path.join(dir, 's' + deals); assert.equal(cli([spec, deals / (cfg.batchDeals || 1), 2, st, 512]).status, 0);
    const g = gainsAt(st, 2); assert.match(g.responseClass, /full best response/);
    assert.equal(g.seats.length, n);
    for (const s of g.seats) assert.ok(s.gain >= -1e-9 * Math.max(1, Math.abs(s.policyValue)), name + ' seat ' + s.seat + ' gain ' + s.gain);
    assert.ok(Math.abs(g.nashConv - g.seats.reduce((a, s) => a + s.gain, 0)) <= 1e-12 * Math.max(1, g.nashConv));
    if (n === 2 && !cfg.icm) assert.equal(g.exploitability, g.nashConv / 2); else assert.equal(g.exploitability, null);
    totals.push(g.seats.reduce((a, s) => a + s.policyValue, 0));
    if (deals === 20000) {
      const bits = [1, 2, 4, 8, 16, 24].map(th => gainsAt(st, th).seats.map(s => s.gainBits).join());
      assert.equal(new Set(bits).size, 1, 'exact gains differ between thread counts: ' + bits.join(' | '));
    }
  }
  assert.ok(Math.abs(totals[0] - totals[1]) <= 1e-9 * Math.max(1, Math.abs(totals[0])), 'value not conserved: ' + totals.join(' vs '));
});

// ---------------- coverage budgets at 16 and 24 workers (Priority 4) ----------------
test('4.6 coverage budgets with 16 and 24 workers: peak <= budget, exact counts equal the audit, EVs identical', { skip, timeout: 900000 }, t => {
  const fx = path.join(__dirname, '..', '..', 'validation', '4.0', 'fixtures'), dir = tmp(t), q = path.join(dir, 'q.json');
  const evs = new Set();
  for (const mib of [1, 2, 8, 32]) for (const threads of [16, 24]) {
    fs.writeFileSync(q, JSON.stringify({ path: [], hands: [0], method: 'exact', device: 'cpu', maxVisits: 2000000000, threads, coverageMiB: mib }));
    const r = cli(['--ev', path.join(fx, 'push8-icm.spec.json'), path.join(fx, 'push8-icm.state'), q], { EM_COVERAGE_AUDIT: '1' }); assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout), m = j.execution.coverageMemory, c = j.coverage;
    assert.equal(m.budgetBytes, mib * 1048576); assert.ok(m.peakBytes <= m.budgetBytes, `${mib} MiB ${threads} threads: peak ${m.peakBytes}`); assert.equal(c.memory.withinBudget, true);
    assert.equal(c.distinctCountKind, 'exact'); assert.equal(c.distinctInformationSets, c.audit.distinctInformationSets); assert.equal(c.distinctFallbackInformationSets, c.audit.distinctFallbackInformationSets);
    evs.add(j.hands[0].evBits.join());
  }
  assert.equal(evs.size, 1);
});
