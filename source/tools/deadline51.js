// EightMax 5.1 (Requirement 4): repeat the v40 deadline test "4.0 deadlines hold for other limits and
// games, and the evaluator stays responsive after repeated timeouts" (tests/v40.test.js) many times,
// idle and under CPU contention, and record for every query: the requested deadline, the process wall
// time from spawn to exit (includes process start and state loading = the queue/start delay), the
// in-process query time (queryMs, what the test asserts), when the evaluator observed the stop
// (stopObservedMs), the largest gap between its clock checks (maxCheckGapMs), the return delay after the
// observation, and the status. Each assertion of the test is re-evaluated on every trial so the margin
// and the would-be failures per assertion are counted.
// usage: node tools/deadline51.js <mwcli> <out.json> [--trials=20] [--contention=0,8] [--threads=2]
'use strict';
process.env.EM_EV_DIRECT_PATTERNS = '1';   // as tests/v40.test.js (4.1 per-board method keeps the workloads heavy)
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
const E = require('./loadlib'); for (const l of ['lib_runouts', 'lib_wide', 'lib_river', 'lib_pushfold', 'lib_explorer']) require('../web/' + l);
const args = process.argv.slice(2), [cliArg, out] = args.filter(a => !a.startsWith('--'));
const opt = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const cli = path.resolve(cliArg), trials = +opt('trials', 20), contention = opt('contention', '0,8').split(',').map(Number), threads = +opt('threads', 2);
const TOLERANCE_MS = 150;   // tests/v40.test.js
const base = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128 };
const FIXED8 = ['AsAh', 'KsKh', 'QsQh', 'JsJh', 'TsTh', '9s9h', '8s8h', '7s7h'], STACKS8 = [30, 22, 15, 40, 9, 18, 25, 12], PAY8 = [30, 20, 14, 11, 9, 7, 5, 4];
const studies = {
  push8: [{ ...base, preflop: { mode: 'shove' }, board: '', dealt: 8, common: 0, stacks: STACKS8, ranges: FIXED8, icm: { payouts: PAY8 }, batchDeals: 4, actionStreams: 'deal', privateSeed: 4 }, 50],
  linked8: [{ ...base, preflop: { mode: 'linked', opens: '2.2,a', raises: 'a', maxBets: 2 }, board: '', dealt: 8, common: 0, stacks: STACKS8, ranges: FIXED8, icm: { payouts: PAY8 }, streets: { flop: { bets: '50', raises: '', maxBets: 1 }, turn: { bets: 'a', raises: '', maxBets: 1 }, river: { bets: 'a', raises: '', maxBets: 1 } }, batchDeals: 4, actionStreams: 'deal', privateSeed: 4 }, 40],
  icmFinal: [{ ...base, preflop: { mode: 'linked', opens: '2.2,a', raises: 'a', maxBets: 2 }, board: '', dealt: 8, common: 0, stacks: STACKS8, ranges: Array(8).fill('random'), icm: { payouts: PAY8 }, streets: { flop: { bets: '50', raises: '', maxBets: 1 }, turn: { bets: 'a', raises: '', maxBets: 1 }, river: { bets: 'a', raises: '', maxBets: 1 } }, batchDeals: 4, actionStreams: 'deal', privateSeed: 4 }, 20],
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em51-deadline-')), S = {};
for (const [k, [sp, it]] of Object.entries(studies)) { const spec = path.join(dir, k + '.json'), state = path.join(dir, k + '.state'); fs.writeFileSync(spec, JSON.stringify(E.MultiwayGame(sp).nativeSpec())); cp.execFileSync(cli, [spec, it, 2, state, 512].map(String)); S[k] = { spec, state }; }
let qn = 0;
function query(k, q) {
  const f = path.join(dir, 'q' + (qn++ % 64) + '.json'); fs.writeFileSync(f, JSON.stringify(q));
  const t0 = process.hrtime.bigint(), r = cp.spawnSync(cli, ['--ev', S[k].spec, S[k].state, f], { encoding: 'utf8', maxBuffer: 64 << 20, env: { ...process.env, EM_QUERY_TIMING: '1' }, timeout: 180000 }), wall = Number(process.hrtime.bigint() - t0) / 1e6;
  let timing = null; try { timing = JSON.parse((r.stderr || '').split('\n')[0]); } catch { }
  const json = r.status === 0 ? JSON.parse(r.stdout) : null, ev = timing && timing.evaluator || {};
  return { study: k, timeLimitMs: q.timeLimitMs, method: q.method, processWallMs: wall, startAndLoadMs: timing ? wall - timing.queryMs : null, queryMs: timing && timing.queryMs, status: timing && timing.status, stopObservedMs: ev.stopObservedMs ?? null, returnAfterObservedMs: timing && ev.stopObservedMs >= 0 ? timing.queryMs - ev.stopObservedMs : null, maxCheckGapMs: json && json.deadline ? json.deadline.maxCheckGapMs : ev.maxCheckGapMs ?? null, checks: ev.checks ?? null, jsonStatus: json && json.status, stoppedEarly: json && json.stoppedEarly, samplesOk: json && json.hands ? json.hands[0].samples >= json.minSamples : null };
}
// one repetition of the test's assertions
function trial() {
  const rows = [], fails = [];
  const cases = [['push8', { path: [], hands: [0], method: 'exact' }], ['linked8', { path: [], hands: [0], method: 'exact' }], ['icmFinal', { path: [], hands: [0, 1, 2], method: 'exact' }], ['icmFinal', { path: [], hands: [3], range: true, method: 'sampled', samples: 2000000 }]];
  for (const [k, q] of cases) for (const ms of [100, 250, 600]) {
    const r = query(k, { ...q, timeLimitMs: ms, maxVisits: 2000000000 }); r.assertion = 'queryMs < limit + 150'; rows.push(r);
    if (!(r.queryMs < ms + TOLERANCE_MS)) fails.push({ assertion: 'deadline ' + k + ' ' + q.method + ' ' + ms + ' ms', queryMs: r.queryMs });
    if (q.method === 'exact' && r.status !== 408) fails.push({ assertion: 'exact status 408', status: r.status });
    if (q.method !== 'exact' && !(r.jsonStatus === 'partial' && r.stoppedEarly && r.samplesOk)) fails.push({ assertion: 'sampled partial result', r });
  }
  for (let i = 0; i < 10; i++) { const r = query('push8', { path: [1, 1], hands: [0], method: 'exact', timeLimitMs: 100 }); r.assertion = 'consecutive timeout < 250 ms'; rows.push(r); if (!(r.queryMs < 100 + TOLERANCE_MS)) fails.push({ assertion: 'ten consecutive timeouts', queryMs: r.queryMs }); }
  const ok = query('push8', { path: [1, 1], hands: [0], method: 'exact', timeLimitMs: 120000, maxVisits: 2000000000 }); ok.assertion = 'completed, maxCheckGapMs < 100'; rows.push(ok);
  if (ok.jsonStatus !== 'completed') fails.push({ assertion: 'completed evaluation', status: ok.jsonStatus });
  if (!(ok.maxCheckGapMs < 100)) fails.push({ assertion: 'largest gap between deadline checks < 100 ms', maxCheckGapMs: ok.maxCheckGapMs });
  return { rows, fails };
}
const q = (a, p) => { const s = a.filter(x => x != null).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
const report = { tool: 'deadline51', generated: new Date().toISOString(), build: cp.execFileSync(cli, ['--build-id'], { encoding: 'utf8' }).trim(), platform: os.platform() + ' ' + os.release(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, trialsPerCondition: trials, test: 'tests/v40.test.js: 4.0 deadlines hold for other limits and games, and the evaluator stays responsive after repeated timeouts', toleranceMs: TOLERANCE_MS, conditions: [] };
for (const c of contention) {
  // contention: c busy-loop processes for the whole condition (CPU-bound load like a shared runner)
  const hogs = Array.from({ length: c }, () => cp.spawn(process.execPath, ['-e', 'for(;;){}'], { stdio: 'ignore' }));
  const rows = [], fails = []; const t0 = Date.now();
  for (let i = 0; i < trials; i++) { const r = trial(); rows.push(...r.rows.map(x => ({ trial: i, ...x }))); fails.push(...r.fails.map(x => ({ trial: i, ...x }))); process.stderr.write('contention ' + c + ' trial ' + (i + 1) + '/' + trials + ' failures ' + r.fails.length + '\n'); }
  for (const h of hogs) h.kill();
  const byKind = k => rows.filter(r => r.assertion === k);
  const summary = (rs, f) => ({ n: rs.length, min: q(rs.map(f), 0), median: q(rs.map(f), 0.5), p95: q(rs.map(f), 0.95), max: q(rs.map(f), 1) });
  const deadlineRows = rows.filter(r => r.assertion !== 'completed, maxCheckGapMs < 100');
  report.conditions.push({ busyProcesses: c, seconds: (Date.now() - t0) / 1000, trials, testFailures: new Set(fails.map(f => f.trial)).size, assertionFailures: fails,
    overshootMs: summary(deadlineRows, r => r.queryMs - r.timeLimitMs), stopObservedAfterLimitMs: summary(deadlineRows, r => r.stopObservedMs >= 0 ? r.stopObservedMs - r.timeLimitMs : null), returnAfterObservedMs: summary(deadlineRows, r => r.returnAfterObservedMs), startAndLoadMs: summary(rows, r => r.startAndLoadMs),
    completedMaxCheckGapMs: summary(byKind('completed, maxCheckGapMs < 100'), r => r.maxCheckGapMs), timeoutMaxCheckGapMs: summary(deadlineRows, r => r.maxCheckGapMs), rows });
  console.log('busy', c, 'trials', trials, 'failing trials', report.conditions.at(-1).testFailures, 'overshoot ms', JSON.stringify(report.conditions.at(-1).overshootMs), 'completed max gap ms', JSON.stringify(report.conditions.at(-1).completedMaxCheckGapMs));
}
fs.writeFileSync(out, JSON.stringify(report, null, 1)); fs.rmSync(dir, { recursive: true, force: true });
