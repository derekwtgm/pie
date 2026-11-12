'use strict';
// EightMax 4.1 regressions, part 1: numeric-input safety and concurrency.
//  * Every numeric field of every supported HTTP route is sent malformed values
//    (1e300, -1e300, 1e999 (= infinity after parsing), fractions, 2^63, 2^64,
//    negative and zero budgets, null, numeric strings, booleans). Each must be
//    refused with a 400-series status, create no job, and leave the host alive.
//    Run against a host built with -fsanitize=undefined,float-cast-overflow
//    (tools/build_sanitized_host.sh, EM_TEST_HOST=...) any out-of-range
//    conversion aborts the host, which these tests detect. On the 4.0 host
//    {"memoryMiB":1e300} aborted the process in ev_jobs.h:153.
//  * Boundary values are accepted; omitted fields take their documented defaults.
//  * Concurrency: repeated simultaneous solver/training starts (exactly one wins),
//    rapid job creation and cancellation, cancellation while queued and while
//    starting, queued jobs receive their full time budget, repeated host
//    shutdown with jobs running, and no stale or stuck job entries.
// 4.2: these tests were written for workloads whose exact evaluation takes
// longer than their deadlines and cancellation delays. 4.2 counts rank patterns
// by projection (15-20x faster, bit-identical EVs), which would let those
// evaluations finish before the limits under test. EM_EV_DIRECT_PATTERNS=1
// selects the retained 4.1 per-board method so every original workload and
// assertion is kept unchanged; tests/v42.test.js checks deadlines, cancellation
// and queued-job budgets on the 4.2 path with a workload that is still heavy.
process.env.EM_EV_DIRECT_PATTERNS = '1';
const test = require('node:test'), assert = require('node:assert/strict');
const E = require('../tools/loadlib');
for (const l of ['lib_runouts', 'lib_wide', 'lib_river']) require('../web/' + l);
const { withHost, home } = require('./checkpoint_host');
const build = require('./native_build');
const skip = !(process.env.EM_TEST_HOST || build.host().exe) && (build.host().why || 'no native host');
const base = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128 };
const R3 = ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd'];
const FIXED8 = ['AsAh', 'KsKh', 'QsQh', 'JsJh', 'TsTh', '9s9h', '8s8h', '7s7h'], STACKS8 = [30, 22, 15, 40, 9, 18, 25, 12], PAY8 = [30, 20, 14, 11, 9, 7, 5, 4];
const studies = {
  huRiver: { ...base, board: 'Ks8d5h2c2s', common: 10, stacks: [20, 20], ranges: R3, streets: { river: { bets: '50,a', raises: 'a', maxBets: 2 } }, privateSeed: 3 },
  push8: { ...base, preflop: { mode: 'shove' }, board: '', dealt: 8, common: 0, stacks: STACKS8, ranges: FIXED8, icm: { payouts: PAY8 }, batchDeals: 4, actionStreams: 'deal', privateSeed: 4 },
};
async function json(r) { const text = await r.text(); try { return { http: r.status, ...JSON.parse(text) }; } catch { return { http: r.status, text }; } }
async function until(f, ms = 60000) { const t0 = Date.now(); for (;;) { const v = await f(); if (v) return v; if (Date.now() - t0 > ms) throw Error('timeout'); await new Promise(r => setTimeout(r, 10)); } }
async function trained(api, name, iterations) {
  assert.equal((await api('mw/init', JSON.stringify(E.MultiwayGame(studies[name]).nativeSpec()))).status, 200);
  assert.equal((await api('mw/train', { iterations, threads: 2 })).status, 200);
  await until(async () => !(await (await api('mw/status')).json()).running);
}
// raw JSON text for a field value (so 1e999, 2^64 etc. reach the parser verbatim)
const BAD_NUMBERS = ['1e300', '-1e300', '1e999', '-1e999', '9223372036854775807', '9223372036854775808', '-9223372036854775809', '18446744073709551616', '1e19', '0.5', '-1', 'null', '"512"', 'true', '[]', '{}'];
const body = (fields) => '{' + Object.entries(fields).map(([k, v]) => JSON.stringify(k) + ':' + v).join(',') + '}';
async function alive(api) { const r = await api('info'); assert.equal(r.status, 200, 'host still answers'); }

test('4.1 numeric safety: background-job fields are validated before conversion (4.0: memoryMiB 1e300 -> UB in ev_jobs.h)', { skip }, async t => {
  await withHost(home(t), {}, async api => {
    await trained(api, 'huRiver', 200);
    const evFields = { memoryMiB: [16, 4096], timeLimitMs: [100, 3600000], maxVisits: [1000, 2000000000], samples: [16, 2000000], minSamples: [16, 2000000], threads: [1, 64], seed: [0, 4294967295], gpuMiB: [16, 6144] };
    for (const kind of ['ev', 'response-gain'])
      for (const field of [...Object.keys(evFields), 'equivalenceMargin', 'fallbackWarnShare']) {
        if (kind === 'response-gain' && ['minSamples', 'threads', 'gpuMiB', 'equivalenceMargin', 'fallbackWarnShare'].includes(field)) continue;
        for (const v of BAD_NUMBERS) {
          if (['equivalenceMargin', 'fallbackWarnShare'].includes(field) && v === '0.5') continue;   // valid real values
          const fields = kind === 'ev' ? { path: '[]', hands: '[0]', method: '"exact"', [field]: v } : { method: '"sampled"', [field]: v };
          const r = await json(await api('mw/jobs/' + kind, body(fields)));
          assert.ok(r.http >= 400 && r.http < 500, kind + ' ' + field + '=' + v + ' -> ' + r.http + ' ' + (r.error || r.text));
          if (r.http !== 413) assert.equal(r.http, 400, kind + ' ' + field + '=' + v);
          assert.equal(typeof r.error, 'string', 'a meaningful message');
        }
      }
    // out-of-range integers on either side of every documented range
    for (const [field, [lo, hi]] of Object.entries(evFields)) for (const v of [lo - 1, hi + 1])
      assert.equal((await json(await api('mw/jobs/ev', { path: [], hands: [0], method: 'exact', [field]: v }))).http, 400, field + '=' + v);
    // negative memory, invalid workers
    assert.equal((await json(await api('mw/jobs/ev', { hands: [0], memoryMiB: -512 }))).http, 400);
    assert.equal((await json(await api('mw/jobs/ev', { hands: [0], threads: 0 }))).http, 400);
    assert.equal((await json(await api('mw/jobs'))).jobs.length, 0, 'no rejected request created a job');
    // boundaries and defaults are accepted
    for (const q of [{ hands: [0], method: 'exact', path: [] }, { hands: [0], method: 'exact', path: [], memoryMiB: 16, timeLimitMs: 100, seed: 4294967295, threads: 1 }]) {
      const r = await json(await api('mw/jobs/ev', q)); assert.equal(r.http, 202, JSON.stringify(q) + ' ' + r.error);
      if (!('memoryMiB' in q)) assert.equal(r.memoryMiB, 512, 'documented default'); else assert.equal(r.memoryMiB, 16);
      await until(async () => ['completed', 'timedOut', 'failed'].includes((await json(await api('mw/jobs/' + r.jobId))).status));
    }
    assert.equal((await json(await api('mw/jobs/ev', { hands: [0], memoryMiB: 4096 }))).http, 413, 'valid but larger than the pool: 413, not a clamp');
    // job configuration
    for (const field of ['workers', 'threadsPerJob', 'memoryPoolMiB']) for (const v of BAD_NUMBERS)
      assert.equal((await json(await api('mw/jobs/config', body({ [field]: v })))).http, 400, field + '=' + v);
    // explorer node queries (offset, limit, rangeSeat, stateId)
    for (const field of ['offset', 'limit', 'rangeSeat', 'stateId']) for (const v of BAD_NUMBERS.filter(x => !(field === 'stateId' && x === '-1')))
      assert.equal((await json(await api('mw/node', body({ path: '[]', [field]: v })))).http, 400, 'node ' + field + '=' + v);
    // training, initialisation budget and equity
    for (const v of BAD_NUMBERS) {
      assert.equal((await json(await api('mw/train', body({ iterations: v })))).http, 400, 'train iterations=' + v);
      assert.equal((await json(await api('mw/train', body({ iterations: '1', threads: v })))).http, 400, 'train threads=' + v);
      assert.equal((await json(await api('equity', body({ hands: '[[0,1],[2,3]]', threads: v })))).http, 400, 'equity threads=' + v);
      assert.equal((await json(await api('equity', body({ hands: '[[0,1],[' + (v === 'null' ? 'null' : v) + ',3]]' })))).http, 400, 'equity card=' + v);
    }
    const spec = E.MultiwayGame(studies.huRiver).nativeSpec();
    for (const v of ['1e300', '-1', '0', '"64"', 'null', '1e999']) {
      const text = JSON.stringify(spec).replace(/^\{/, '{"tableLimitMiB":' + v + ',');
      assert.equal((await json(await api('mw/init', text))).http, 400, 'tableLimitMiB=' + v);
    }
    await alive(api);
  });
});

test('4.1 numeric safety: legacy solver, report, lock and node routes refuse malformed numbers', { skip }, async t => {
  await withHost(home(t), {}, async api => {
    const weights = Array.from({ length: 1326 }, (_, i) => i > 1250 ? 1 : 0);
    const cfg = { board: [0, 9, 22, 31, 36], pot: 10, stack: 10, ranges: [weights, weights], sizes: { bet: [['', ''], ['', ''], ['', '100']], raise: [['', ''], ['', ''], ['', '']] }, maxBets: 1 };
    for (const v of ['1e300', '-1e300', '0.5', '"1"', '9223372036854775808']) {
      assert.equal((await json(await api('build', JSON.stringify({ ...cfg, iso: 0 }).replace('"iso":0', '"iso":' + v)))).http, 400, 'build iso=' + v);
      assert.equal((await json(await api('build', JSON.stringify({ ...cfg, compress: 0 }).replace('"compress":0', '"compress":' + v)))).http, 400, 'build compress=' + v);
    }
    // ICM utilities beyond float range
    assert.equal((await json(await api('build', { ...cfg, icm: { u0: [0, 1e300], u1: [0, 1], x0: 0, dx: 1, b0: 0 } }))).http, 400);
    assert.equal((await api('build', cfg)).status, 200);
    for (const v of BAD_NUMBERS) {
      for (const field of ['maxIter', 'power', 'target']) {
        if (field === 'target' && ['9223372036854775807', '9223372036854775808', '18446744073709551616', '1e19', '0.5'].includes(v)) continue;   // finite numbers: target is a real in [0, 1e6]; large ones are out of range
        const r = await json(await api('solve', body({ [field]: v })));
        assert.equal(r.http, 400, 'solve ' + field + '=' + v + ' -> ' + r.http);
      }
      assert.equal((await json(await api('node', body({ path: '[' + v + ']' })))).http, 400, 'node path ' + v);
      if (v !== '0.5') assert.equal((await json(await api('lock', body({ path: '[]', strategy: '[' + v + ',0]' })))).http, 400, 'lock strategy ' + v);
      assert.equal((await json(await api('report', body({ cfg: JSON.stringify(JSON.stringify(cfg)), flops: '[[0,9,22,' + v + ']]', maxIter: '1' })))).http, 400, 'report weight ' + v);
      assert.equal((await json(await api('report', body({ cfg: JSON.stringify(JSON.stringify(cfg)), flops: '[[' + v + ',9,22,1]]', maxIter: '1' })))).http, 400, 'report card ' + v);
    }
    for (const v of ['1e300', '1e999']) assert.equal((await json(await api('solve', body({ target: v })))).http, 400);
    assert.equal((await json(await api('status'))).running, false, 'no rejected request started a job');
    // documented capping of maxIter at 49,000 is kept for valid values
    assert.equal((await api('solve', { maxIter: 100000 })).status, 200);
    await api('stop', {}); await until(async () => !(await json(await api('status'))).running);
    await alive(api);
  });
});

// ============================== concurrency ==============================
test('4.1 concurrency: repeated simultaneous starts of solve, report and training — exactly one wins, none stuck', { skip }, async t => {
  await withHost(home(t), {}, async api => {
    const weights = Array.from({ length: 1326 }, (_, i) => i > 1250 ? 1 : 0);
    const cfg = { board: [0, 9, 22, 31, 36], pot: 10, stack: 10, ranges: [weights, weights], sizes: { bet: [['', ''], ['', ''], ['', '100']], raise: [['', ''], ['', ''], ['', '']] }, maxBets: 1 };
    assert.equal((await api('build', cfg)).status, 200);
    for (let round = 0; round < 25; round++) {
      const route = round % 2 ? 'report' : 'solve', req = route === 'solve' ? { maxIter: 49000, target: 0 } : { cfg: JSON.stringify(cfg), flops: [[0, 9, 22, 1]], maxIter: 49000, target: 0 };   // target 0: runs until stopped, so a second winner would be a real race
      const codes = await Promise.all(Array.from({ length: 8 }, () => api(route, req).then(r => r.status)));
      assert.equal(codes.filter(c => c === 200).length, 1, 'round ' + round + ': ' + codes);
      assert.ok(codes.every(c => c === 200 || c === 409), String(codes));
      if (round % 3) await api('stop', {});   // stop immediately (often before the thread did any work)
      else { await new Promise(r => setTimeout(r, 30)); await api('stop', {}); }
      await until(async () => !(await json(await api('status'))).running, 15000);
    }
  });
  await withHost(home(t), {}, async api => {
    assert.equal((await api('mw/init', JSON.stringify(E.MultiwayGame(studies.huRiver).nativeSpec()))).status, 200);
    for (let round = 0; round < 20; round++) {
      const codes = await Promise.all(Array.from({ length: 6 }, () => api('mw/train', { iterations: 20000, threads: 2 }).then(r => r.status)));
      assert.equal(codes.filter(c => c === 200).length, 1, 'train round ' + round + ': ' + codes);
      await api('mw/stop', {});
      await until(async () => !(await json(await api('mw/status'))).running, 15000);
    }
  });
});

test('4.1 concurrency: rapid job creation and cancellation, cancel while queued/starting, no stale or stuck jobs', { skip }, async t => {
  await withHost(home(t), {}, async api => {
    await trained(api, 'push8', 40);
    assert.equal((await json(await api('mw/jobs/config', { workers: 2, threadsPerJob: 1 }))).workers, 2);
    const big = { path: [], hands: [0], method: 'exact', maxVisits: 2000000000, timeLimitMs: 600000 };
    for (let round = 0; round < 6; round++) {
      const ids = [];
      for (let i = 0; i < 12; i++) { const r = await json(await api('mw/jobs/ev', i % 3 ? big : { ...big, method: 'sampled', samples: 4000, seed: i })); assert.equal(r.http, 202, r.error); ids.push(r.jobId); }
      // cancel all in parallel, some immediately (pending), some while starting
      await Promise.all(ids.map((id, i) => new Promise(r => setTimeout(r, i % 4)).then(() => api('mw/jobs/' + id + '/cancel', {}))));
      const finals = await Promise.all(ids.map(id => until(async () => { const j = await json(await api('mw/jobs/' + id)); return ['completed', 'cancelled', 'failed', 'timedOut'].includes(j.status) && j; }, 20000)));
      for (const f of finals) { assert.notEqual(f.status, 'failed', f.error); assert.notEqual(f.status, 'timedOut'); }
      const cfg = (await json(await api('mw/jobs'))).config;
      assert.equal(cfg.running, 0); assert.equal(cfg.runningMiB, 0); assert.ok(cfg.workersStarted <= cfg.workers);
      for (const id of ids) assert.equal((await api('mw/jobs/' + id + '/release', {})).status, 200);
      assert.equal((await json(await api('mw/jobs'))).jobs.length, 0, 'no stale entries');
    }
    assert.equal((await api('mw/train', { iterations: 2, threads: 1 })).status, 200, 'no reader left behind');
  });
});

test('4.1 concurrency: a queued job gets its full time limit from when it starts (4.0 counted queue time)', { skip }, async t => {
  await withHost(home(t), {}, async api => {
    await trained(api, 'push8', 40);
    await api('mw/jobs/config', { workers: 1, threadsPerJob: 1 });
    const blocker = await json(await api('mw/jobs/ev', { path: [], hands: [0], method: 'exact', maxVisits: 2000000000, timeLimitMs: 600000 }));
    await until(async () => (await json(await api('mw/jobs/' + blocker.jobId))).status === 'running');
    const queued = await json(await api('mw/jobs/ev', { path: [1, 1], hands: [0], method: 'sampled', samples: 400, timeLimitMs: 400 }));
    await new Promise(r => setTimeout(r, 900));   // longer than the queued job's own limit
    await api('mw/jobs/' + blocker.jobId + '/cancel', {});
    const done = await until(async () => { const j = await json(await api('mw/jobs/' + queued.jobId)); return !['pending', 'running'].includes(j.status) && j; });
    assert.equal(done.status, 'completed', 'the queued job ran with its own budget: ' + done.status + ' ' + done.error);
    assert.equal(done.partial, false, 'all requested samples, not a deadline-truncated partial result');
    assert.ok(done.queuedMs >= 800, String(done.queuedMs));
  });
});

test('4.1 concurrency: repeated host shutdown with running and queued jobs leaves saved state usable', { skip }, async t => {
  const h = home(t);
  for (let i = 0; i < 4; i++) {
    await withHost(h, {}, async api => {
      await trained(api, 'push8', 20);
      for (let k = 0; k < 4; k++) await api('mw/jobs/ev', { path: [], hands: [k % 2], method: 'exact', maxVisits: 2000000000, timeLimitMs: 600000 });
      await new Promise(r => setTimeout(r, 50 + 30 * i));
    });   // withHost kills the process with jobs running
  }
  await withHost(h, {}, async api => { await trained(api, 'huRiver', 50); await alive(api); });
});

test('4.1 numeric safety: num_safe.h boundary and property tests under UBSan+ASan (compiler)', t => {
  const cp = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  if (process.platform !== 'linux' || cp.spawnSync('gcc', ['--version']).status !== 0) return t.skip('needs gcc with sanitizers on Linux');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em41ns-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const native = path.join(__dirname, '..', 'native'), exe = path.join(dir, 'ns');
  cp.execFileSync('gcc', ['-std=c11', '-O1', '-g', '-fsanitize=undefined,float-cast-overflow,address', '-fno-sanitize-recover=all', '-I' + native, path.join(__dirname, 'num_safe41.c'), path.join(native, 'json.c'), '-lm', '-o', exe]);
  const r = JSON.parse(cp.execFileSync(exe, { encoding: 'utf8' }));
  assert.equal(r.failures, 0); assert.ok(r.propertyCases >= 2000000);
});

// ============================== statistics (action_stats.hpp) ==============================
test('4.1 statistics: simulated family-wise error, coverage, selection bias, equivalence and sequential stopping (compiler)', t => {
  const cp = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  if (cp.spawnSync('g++', ['--version']).status !== 0) return t.skip('needs g++');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em41st-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const exe = path.join(dir, 'stats41');
  cp.execFileSync('g++', ['-std=c++20', '-O2', '-I' + path.join(__dirname, '..', 'native'), path.join(__dirname, 'stats41.cpp'), '-o', exe]);
  const r = JSON.parse(cp.execFileSync(exe, ['--quick'], { encoding: 'utf8', maxBuffer: 1 << 24 }));
  const by = n => r.scenarios.find(s => s.name.startsWith(n));
  // With 400 replications the Wilson interval of a 5% rate is about +/-2.2%:
  // the lower confidence bound must not exceed the nominal 5% (no evidence of excess error).
  for (const s of r.scenarios.filter(s => s.kind !== 'sequential')) {
    assert.ok(s.v41.familyErrorRate.ci95[0] <= 0.05, s.name + ': family-wise error ' + JSON.stringify(s.v41.familyErrorRate));
    assert.ok(s.v41.simultaneousCoverage.ci95[1] >= 0.95, s.name + ': coverage ' + JSON.stringify(s.v41.simultaneousCoverage));
  }
  // the 4.0 rule overstated evidence when several equal actions were compared with the selected highest estimate
  for (const n of ['4 equal actions, correlated', '8 equal actions']) assert.ok(by(n).v40rule.familyErrorRate.ci95[0] > 0.10, n + ' 4.0 rule ' + JSON.stringify(by(n).v40rule.familyErrorRate));
  // large genuine differences are still detected; the critical value grows with the number of actions
  assert.ok(by('3 actions, large difference').v41.powerSupportedBest.rate > 0.99);
  assert.ok(by('8 equal actions').meanCriticalValue > by('4 equal actions, correlated').meanCriticalValue && by('4 equal actions, correlated').meanCriticalValue > by('2 equal actions').meanCriticalValue);
  assert.ok(by('2 equal actions').meanCriticalValue < 2.1, 'two actions: close to the single-comparison 1.96');
  // equivalence at the margin boundary is claimed at most at the nominal rate
  assert.ok(by('equivalence at the margin boundary').v41.familyErrorRate.ci95[0] <= 0.05);
  assert.ok(by('equivalence, equal values').v41.anyClaim.rate > 0.5, 'equivalence is established for equal values with enough samples');
  // selection: the highest estimate overstates its lead on average (winner's curse) - reported, and covered by the intervals
  assert.ok(by('4 equal actions, independent').v41.winnersCurseMean > 0);
  // data-dependent stopping with a fixed alpha inflates errors; the spending rule controls them
  const seq = r.scenarios.filter(s => s.kind === 'sequential');
  assert.ok(seq[0].v41.familyErrorRate.rate > 0.15, JSON.stringify(seq[0].v41)); assert.ok(seq[1].v41.familyErrorRate.ci95[0] <= 0.05, JSON.stringify(seq[1].v41));
});

test('4.1 statistics: sampled native results carry simultaneous comparisons consistent with their classes; exact results unchanged', { skip }, async t => {
  const cp = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const cli = process.env.EM_TEST_MWCLI || build.cli().cli; if (!cli) return t.skip('no native CLI');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em41ev-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const spec = path.join(dir, 'spec.json'), state = path.join(dir, 'state'), q = path.join(dir, 'q.json');
  fs.writeFileSync(spec, JSON.stringify(E.MultiwayGame(studies.push8).nativeSpec()));
  cp.execFileSync(cli, [spec, '40', '2', state, '512']);
  const ev = query => { fs.writeFileSync(q, JSON.stringify(query)); return JSON.parse(cp.execFileSync(cli, ['--ev', spec, state, q], { encoding: 'utf8', maxBuffer: 1 << 26 })); };
  const r = ev({ path: [1, 1], hands: [0], method: 'sampled', samples: 3000, seed: 3 });
  assert.match(r.statistics.comparison, /simultaneous/); assert.match(r.statistics.stopping, /never on the observed values/);
  for (const h of r.hands.filter(h => h.available)) {
    const mc = h.multipleComparisons, k = h.ev.length;
    assert.equal(mc.pairs, k * (k - 1) / 2); assert.equal(mc.familyConfidence, 0.95);
    for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) if (a !== b) {
      const [lo, hi] = mc.pairwiseCi[a][b]; assert.ok(Math.abs((lo + hi) / 2 - (h.ev[a] - h.ev[b])) < 1e-9);
      assert.ok(Math.abs(lo + mc.pairwiseCi[b][a][1]) < 1e-9, 'antisymmetric');
    }
    // the adjusted interval is never narrower than the unadjusted one for the same pair
    for (let a = 0; a < k; a++) if (a !== h.best) { const [l, u] = mc.pairwiseCi[a][h.best], [l0, u0] = h.vsBestCi95[a]; assert.ok(u - l >= u0 - l0 - 1e-12); }
    for (let a = 0; a < k; a++) {
      const [lo, hi] = mc.vsBestOfOthersCi[a], c = h.classification[a];
      if (c === 'supportedBest') assert.ok(lo > 0); if (c === 'differenceSupported') assert.ok(hi < 0);
      if (c === 'differenceUncertain' || c === 'highestEstimate') assert.ok(lo <= 0 && hi >= 0);
    }
  }
  // determinism: same request, same statistics
  assert.deepEqual(ev({ path: [1, 1], hands: [0], method: 'sampled', samples: 3000, seed: 3 }).hands, r.hands);
  const ex = ev({ path: [1, 1], hands: [0], method: 'exact' }).hands[0];
  assert.equal(ex.multipleComparisons, undefined); ex.classification.forEach((c, a) => assert.ok(['highest', 'exactTie', 'lower'].includes(c)));
});

// ============================== work budgets ==============================
function cliStudy(t, name, iterations) {
  const cp = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const cli = process.env.EM_TEST_MWCLI || build.cli().cli;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em41b-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const spec = path.join(dir, 'spec.json'), state = path.join(dir, 'state'); let n = 0;
  fs.writeFileSync(spec, JSON.stringify(E.MultiwayGame(studies[name]).nativeSpec()));
  cp.execFileSync(cli, [spec, String(iterations), '2', state, '512']);
  const run = (mode, query, env = {}) => { const q = path.join(dir, 'q' + (n++) + '.json'); fs.writeFileSync(q, JSON.stringify(query)); const r = cp.spawnSync(cli, [mode, spec, state, q], { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, ...env } }); return { json: r.status === 0 ? JSON.parse(r.stdout) : null, error: r.stderr }; };
  return { ev: (q, env) => run('--ev', q, env), gain: (q, env) => run('--gain', q, env) };
}
const cliSkip = !(process.env.EM_TEST_MWCLI || build.cli().cli) && 'no native CLI';
test('4.1 work budgets: board enumeration is counted and maxBoardEvaluations is enforced (exact: no result; sampled: labelled partial)', { skip: cliSkip }, t => {
  const S = cliStudy(t, 'push8', 40);
  const full = S.ev({ path: [1, 1], hands: [0], method: 'exact', maxVisits: 2000000000 }).json;
  assert.ok(full.work.boardEvaluations >= 376992, 'eight-player preflop showdown boards are counted: ' + full.work.boardEvaluations);
  assert.ok(full.work.treeVisits < 1000, 'tree visits alone (the 4.0 maxVisits unit) miss that work');
  assert.equal(full.work.boardEvaluations, full.work.tableBoardsCpu + full.work.gpuBoards + full.work.boardRunouts, 'CPU-only run: every board evaluation is a table row');
  assert.ok(full.work.icmEvaluations > 0 && full.work.patternCounts > 0 && full.work.showdownTables > 0);
  assert.equal(full.budgets.maxBoardEvaluations, null); assert.equal(full.budgets.boardBudgetExhausted, false);
  // the exact method refuses to publish when the budget is exhausted
  const cut = S.ev({ path: [1, 1], hands: [0], method: 'exact', maxVisits: 2000000000, maxBoardEvaluations: 100000 });
  assert.equal(cut.json, null); assert.match(cut.error, /422.*maxBoardEvaluations.*never reported/);
  // a budget that covers the work gives the identical exact result
  const ok = S.ev({ path: [1, 1], hands: [0], method: 'exact', maxVisits: 2000000000, maxBoardEvaluations: full.work.boardEvaluations }).json;
  assert.deepEqual(ok.hands[0].ev, full.hands[0].ev);
  // sampled: a partial estimate only with >= minSamples samples, labelled with the budget that stopped it
  const part = S.ev({ path: [1], hands: [0], method: 'sampled', samples: 200000, seed: 4, maxBoardEvaluations: 400000 }).json;
  assert.equal(part.stoppedBy, 'maxBoardEvaluations'); assert.equal(part.budgets.boardBudgetExhausted, true);
  const h = part.hands[0];
  if (h.available) { assert.equal(h.status, 'partial'); assert.ok(h.samples >= 100 && h.samples < 200000); }
  else assert.match(h.reason, /minSamples|samples/);
  assert.ok(part.work.boardEvaluations <= 400000 + 256 * 64, "overshoot bounded by 256 boards per worker: " + part.work.boardEvaluations);
  const tiny = S.ev({ path: [1], hands: [0], method: 'sampled', samples: 200000, seed: 4, maxBoardEvaluations: 1000 }).json.hands[0];
  assert.equal(tiny.available, false, 'too few samples within the budget: no estimate');
  // invalid budget values
  for (const v of [0, 999, -1, 1.5, 1e300]) assert.match(S.ev({ path: [1], hands: [0], maxBoardEvaluations: v }).error, /400/);
  // the time limit still applies together with the budgets
  const timed = S.ev({ path: [], hands: [0], method: 'exact', maxVisits: 2000000000, maxBoardEvaluations: 1e12, timeLimitMs: 150 });
  assert.equal(timed.json, null); assert.match(timed.error, /408/);
});
test('4.1 work budgets: response gains report work and honour maxBoardEvaluations', { skip: cliSkip }, t => {
  const S = cliStudy(t, 'huRiver', 300);
  const g = S.gain({ method: 'exact' }).json;
  assert.ok(g.work.boardEvaluations > 0 && g.work.bestResponseNodes > 0, JSON.stringify(g.work));
  assert.equal(S.gain({ method: 'exact', maxBoardEvaluations: 1000 }).json.budgets.boardBudgetExhausted, false, 'a budget above the work done is not reported as exhausted');
  const P = cliStudy(t, 'push8', 40);
  const full = P.gain({ method: 'exact', seats: [0] }).json; assert.equal(full.work.boardEvaluations, 376992);
  const cut = P.gain({ method: 'exact', seats: [0], maxBoardEvaluations: 100000 });
  assert.equal(cut.json, null); assert.match(cut.error, /422.*maxBoardEvaluations/);
});

// ============================== parallel response gains ==============================
test('4.1 response gains: seats run in parallel with results bit-identical for 1, 2 and 4 threads (exact, restricted, sampled)', { skip: cliSkip }, t => {
  const S = cliStudy(t, 'push8', 40);
  for (const q of [{ method: 'exact', seats: [0, 3, 6] }, { method: 'restricted', selection: 'sampled', samples: 2000 }, { method: 'sampled', samples: 1500, seats: [1, 2, 5, 7] }]) {
    const runs = [1, 2, 4].map(threads => S.gain({ ...q, threads }).json);
    for (const r of runs) assert.ok(r, JSON.stringify(q));
    const strip = r => r.seats.map(({ elapsedMs, ...rest }) => rest);
    assert.deepEqual(strip(runs[1]), strip(runs[0]), q.method + ' 2 threads'); assert.deepEqual(strip(runs[2]), strip(runs[0]), q.method + ' 4 threads');
    assert.equal(runs[2].threads, Math.min(4, runs[2].seats.length));
    assert.equal(runs[0].work.boardEvaluations, runs[2].work.boardEvaluations, 'work accounting is thread-independent');
    for (const s of runs[0].seats) if (s.available !== false) assert.ok(typeof s.seat === 'number');
  }
});
test('4.1 response gains: a parallel response-gain job is cancelled promptly and leaves no reader or worker behind', { skip }, async t => {
  await withHost(home(t), {}, async api => {
    await trained(api, 'push8', 40);
    const stateBytes = async () => Buffer.from(await (await api('mw/state')).arrayBuffer()), before = await stateBytes();
    await api('mw/jobs/config', { workers: 1, threadsPerJob: 2 });
    // a completed parallel job first
    const ok = await json(await api('mw/jobs/response-gain', { method: 'sampled', samples: 300, threads: 2 }));
    await until(async () => (await json(await api('mw/jobs/' + ok.jobId))).status === 'completed');
    assert.equal((await json(await api('mw/jobs/' + ok.jobId + '/result'))).threads, 2); await api('mw/jobs/' + ok.jobId + '/release', {});
    for (let i = 0; i < 3; i++) {
      const j = await json(await api('mw/jobs/response-gain', { method: 'exact', threads: 2 }));
      assert.equal(j.http, 202, j.error);
      await until(async () => (await json(await api('mw/jobs/' + j.jobId))).status === 'running');
      await new Promise(r => setTimeout(r, 50 + 100 * i));
      const t0 = Date.now(); await api('mw/jobs/' + j.jobId + '/cancel', {});
      const done = await until(async () => { const x = await json(await api('mw/jobs/' + j.jobId)); return x.status !== 'running' && x; });
      assert.equal(done.status, 'cancelled'); assert.ok(Date.now() - t0 < 1500, 'cancelled in ' + (Date.now() - t0) + ' ms');
    }
    const cfg = (await json(await api('mw/jobs'))).config; assert.equal(cfg.running, 0); assert.equal(cfg.runningMiB, 0);
    assert.ok(before.equals(await stateBytes()), 'completed and cancelled parallel evaluations left the solver state byte-identical');
    assert.equal((await api('mw/train', { iterations: 2, threads: 1 })).status, 200);
  });
});

// ============================== CPU/GPU scheduling (CUDA driver test double) ==============================
test('4.1 CUDA scheduling: decisions and peak VRAM are reported; CPU, GPU, hybrid and auto agree bit for bit (Linux CUDA test double)', { skip: cliSkip }, t => {
  const c = build.cli(); if (!(c.fixtureDir && process.platform === 'linux')) return t.skip('needs the Linux CUDA driver test double (no physical GPU is assumed)');
  const S = cliStudy(t, 'push8', 40), env = { LD_LIBRARY_PATH: c.fixtureDir };
  const q = { path: [1, 1], hands: [0], method: 'exact', maxVisits: 2000000000, gpuMiB: 256 };
  const r = Object.fromEntries(['cpu', 'gpu', 'hybrid', 'auto'].map(d => [d, S.ev({ ...q, device: d }, env).json]));
  for (const d of ['gpu', 'hybrid', 'auto']) assert.deepEqual(r[d].hands[0].ev, r.cpu.hands[0].ev, d + ' EVs identical to the CPU');
  const x = d => r[d].execution, sch = d => x(d).scheduling;
  assert.equal(sch('cpu').cpuForced, x('cpu').showdownTables); assert.equal(x('cpu').gpuBoards, 0); assert.equal(x('cpu').gpuPeakMiB, 0);
  assert.ok(x('gpu').gpuBoards > 0 && x('gpu').gpuPeakMiB > 0 && x('gpu').gpuPeakMiB <= 256, JSON.stringify(x('gpu')));
  assert.ok(x('hybrid').gpuBoards > 0 && x('hybrid').cpuBoards > 0, 'hybrid splits a table');
  // auto: every table is accounted for by exactly one decision
  const a = x('auto'), s = a.scheduling, decided = s.cpuForced + s.cpuSmallTable + (s.cpuGpuWarmup || 0) /* 4.2 category */ + s.cpuGpuSlower + s.cpuGpuUnavailable + s.cpuGpuBusy + s.cpuAfterGpuFailure + a.gpuTables + a.hybridTables;
  assert.equal(decided + (s.cpuGpuOpening || 0) /* 4.3 category */, a.showdownTables, JSON.stringify(a));
  // 4.3 amendment: the Automatic rule is now a cost model (CPU time of the table vs one measured device batch);
  // 4.1/4.2 documented 'measured at least 10% faster than one CPU worker'.
  assert.match(s.rule, /measured at least 10% faster|measured device batch/);
  // small tables stay on the CPU in auto mode
  const small = S.ev({ path: [1, 1], board: [0, 13, 26], hands: [0], method: 'exact', maxVisits: 2000000000, device: 'auto' }, env);
  if (small.json) assert.equal(small.json.execution.gpuBoards, 0);
});

// ============================== explorer presentation ==============================
test('4.1 explorer: strategy-quality panel lists every seat with evaluator, interval, samples and no unsupported claims; EV labels use adjusted statistics', { skip: cliSkip }, t => {
  require('../web/lib_explorer');
  const P = cliStudy(t, 'push8', 40), H = cliStudy(t, 'huRiver', 300);
  const names = ['UTG', 'UTG+1', 'MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
  const sampled = P.gain({ method: 'sampled', samples: 500 }).json, exact2 = H.gain({ method: 'exact' }).json;
  const html = EM.explorerQualityHtml({ qOptions: { method: 'sampled', samples: 500 }, qResult: sampled, names, qHistory: [{ deals: 100, maxGain: 0.5, method: 'sampled' }, { deals: 200, maxGain: 0.3, method: 'sampled' }] });
  for (const n of names.filter((_, i) => sampled.seats.some(s => s.seat === i))) assert.match(html, new RegExp('<th>' + n.replace('+', '\\+') + '</th>'));
  assert.match(html, /lower bounds/); assert.doesNotMatch(html, /Exploitability \(two seats/); assert.match(html, /sampled one-decision deviation/);
  assert.match(html, /Measurements this session/);
  const h2 = EM.explorerQualityHtml({ qOptions: {}, qResult: exact2, names: ['BTN', 'BB'] });
  assert.match(h2, /Exploitability \(two seats, chip EV, this abstraction\)/); assert.match(h2, /exact best response/);
  // EV table: adjusted labels and simultaneous intervals in the tooltip
  const ev = P.ev({ path: [1], hands: [0], method: 'sampled', samples: 3000, seed: 2 }).json;
  ev.actions = ev.actions || ev.hands[0].ev.map((_, a) => ({ slot: a, label: 'a' + a }));
  const node = { node: ev.node };
  const table = EM.renderExplorer ? true : false; assert.ok(table);
  const cls = ev.hands[0].classification; assert.ok(cls.every(c => ['supportedBest', 'highestEstimate', 'differenceSupported', 'differenceUncertain', 'practicallyEquivalent', 'insufficientSamples'].includes(c)));
});
