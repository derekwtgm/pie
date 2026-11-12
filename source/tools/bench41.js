// EightMax 4.1 (Priority 16): reproducible 4.0 versus 4.1 evaluation benchmarks
// (derived from tools/bench40.js; same scenarios, studies and requests).
// usage: node tools/bench41.js <mwcli-4.0> <mwcli-4.1> <peak_rss helper> <out.json> [--quick] [--limit=seconds]
// Differences from bench40: the newer engine also runs response gains with 1
// thread and with all logical CPUs (4.1 evaluates seats in parallel), work
// counters and budgets (4.1) are recorded, and identical results across thread
// counts and versions are checked. Field names: v40 = old engine, v41 = new.
//
// For each scenario and training seed (privateSeed 1..3) the study is trained
// once (3.9 and 4.0 train byte-identical states; checked here per scenario),
// then both engines answer the SAME 3.9-compatible requests:
//   - exact action EV (where it completes within the limit),
//   - sampled action EV (fixed samples and seed),
//   - a response-gain measurement (exact for small games, sampled otherwise),
//   - the same exact request with a 100 ms time limit (deadline overshoot).
// 4.0 runs each request with 1 evaluation thread and with all logical CPUs
// (extra field "threads"; results are identical by construction and checked).
// Recorded per run: wall time (process), query time, peak RSS (wait4), method,
// samples/visits, EV of every action, standard errors, response gains,
// coverage (4.0), exit status. 3.9 runs are killed after `limit` seconds and
// reported as not finished. Peak VRAM is not measured (no NVIDIA GPU here).
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawnSync, execFileSync } = require('node:child_process');
const [cli39, cli40, peak, out] = process.argv.slice(2).filter(a => !a.startsWith('--')), quick = process.argv.includes('--quick');
const src = path.join(__dirname, '..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em41-bench-'));
const logical = os.cpus().length, limitArg = process.argv.find(a => a.startsWith('--limit=')), limit = limitArg ? +limitArg.slice(8) : quick ? 60 : 300, seeds = quick ? [1] : [1, 2, 3];
// [label, study, iterations, threads, players, street, exact request (or null), sampled request, gain request]
const scenarios = [
  ['Heads-up river', 'huRiver', 3000, 1, 2, 'river', { path: [], hands: [0, 1, 2, 3], range: true }, { path: [], hands: [0, 1, 2, 3], samples: 20000 }, { method: 'exact' }],
  ['Heads-up turn', 'huTurn', 1000, 1, 2, 'turn', { path: [], hands: [0, 1, 2, 3], range: true }, { path: [], hands: [0, 1, 2, 3], samples: 20000 }, { method: 'exact' }],
  ['Three-player river (side pots)', 'threeSide', 1500, 1, 3, 'river', { path: [], hands: [0, 1, 2, 3], range: true }, { path: [], hands: [0, 1, 2, 3], samples: 20000 }, { method: 'exact' }],
  ['Four-player flop', 'four', 600, 2, 4, 'flop', { path: [], hands: [0, 1] }, { path: [], hands: [0, 1], samples: 5000 }, { method: 'sampled', samples: 2000, selectionSamples: 32, reachSamples: 4000 }],
  ['Six-player flop', 'six', 400, 2, 6, 'flop', { path: [], hands: [0] }, { path: [], hands: [0, 1], samples: 5000 }, { method: 'sampled', samples: 2000, selectionSamples: 32, reachSamples: 4000 }],
  ['Eight-player preflop (push/fold, fixed hands)', 'push8', 50, 2, 8, 'preflop', { path: [1, 1], hands: [0] }, { path: [], hands: [0], samples: 5000 }, { method: 'sampled', samples: 2000, selectionSamples: 32, reachSamples: 4000 }],
  ['Eight-player linked preflop-to-river (fixed hands)', 'linked8', 40, 2, 8, 'preflop', { path: [1, 1, 1, 1, 1], hands: [0] }, { path: [], hands: [0], samples: 2000 }, { method: 'sampled', samples: 1000, selectionSamples: 16, reachSamples: 2000 }],
  ['Multiway short-stack all-ins (chip EV)', 'push8chip', 50, 2, 8, 'preflop', { path: [1, 1, 1], hands: [0] }, { path: [1], hands: [0], samples: 5000 }, { method: 'sampled', samples: 2000, selectionSamples: 32, reachSamples: 4000 }],
  ['Tournament bubble ICM (4 players, random ranges)', 'bubble', 200, 2, 4, 'preflop', null, { path: [], hands: [0, 500, 1000], range: true, samples: 5000 }, { method: 'sampled', samples: 2000, selectionSamples: 16, reachSamples: 4000 }],
  ['Eight-player final-table ICM (random ranges)', 'icmFinal', 40, 2, 8, 'preflop', null, { path: [], hands: [0, 600], range: true, samples: 2000 }, { method: 'sampled', samples: 1000, selectionSamples: 16, reachSamples: 2000 }],
];
function call(cli, mode, spec, state, q, extraEnv = {}) {
  const f = path.join(dir, 'q.json'); fs.writeFileSync(f, JSON.stringify(q));
  const t0 = process.hrtime.bigint();
  const r = spawnSync(peak, [cli, mode, spec, state, f], { encoding: 'utf8', maxBuffer: 256 << 20, timeout: limit * 1000, env: { ...process.env, EM_QUERY_TIMING: '1', ...extraEnv } });
  const wall = Number(process.hrtime.bigint() - t0) / 1e9;
  const err = r.stderr || ''; const rss = /peakRssKiB=(\d+)/.exec(err), timing = /\{"queryMs":([0-9.]+)(?:,"cancelLatencyMs":([0-9.]+))?,"status":(\d+)\}/.exec(err);
  let json = null; try { json = r.status === 0 ? JSON.parse(r.stdout) : null; } catch { }
  return { finished: !r.error && r.signal == null, wallSeconds: +wall.toFixed(4), queryMs: timing ? +timing[1] : null, cancelLatencyMs: timing && timing[2] ? +timing[2] : null, httpStatus: timing ? +timing[3] : (r.status === 0 ? 200 : null),
    peakRssMiB: rss ? +(rss[1] / 1024).toFixed(1) : null, error: r.status === 0 ? null : (err.split('\n').find(l => /^error/.test(l)) || (r.signal ? 'killed after ' + limit + ' s' : 'exit ' + r.status)), json };
}
const evSummary = j => j && { method: j.method, status: j.status || (j.stoppedEarly ? 'partial' : 'completed'), hands: j.hands.map(h => h.available ? { i: h.i, ev: h.ev, stdErr: h.stdErr, samples: h.samples, visits: h.visits } : { i: h.i, available: false }), range: j.range && j.range.available ? { ev: j.range.ev, stdErr: j.range.stdErr } : null,
  coverage: j.coverage ? { rowCoverage: j.coverage.rowCoverage, maxActionFallbackShare: j.coverage.maxActionFallbackShare, influence: j.coverage.influence } : undefined, execution: j.execution, threads: j.threads,
  classification: j.hands.map(h => h.classification), work: j.work, budgets: j.budgets };
const gainSummary = j => j && { method: j.method, threads: j.threads, work: j.work, nashConv: j.nashConv, exploitability: j.exploitability, seats: j.seats.map(s => ({ seat: s.seat, gain: typeof s.gain === 'number' ? s.gain : s.gain && s.gain.mean, stdErr: typeof s.gain === 'number' ? 0 : s.gain && s.gain.stdErr })) };
const maxRel = (a, b) => { let m = 0; a.hands.forEach((h, i) => { if (h.ev && b.hands[i].ev) h.ev.forEach((v, x) => { m = Math.max(m, Math.abs(v - b.hands[i].ev[x]) / Math.max(1, Math.abs(v))); }); }); return m; };
const report = { versions: { old: '4.0', new: '4.1' }, generated: new Date().toISOString(), cpu: os.cpus()[0].model, logicalCPUs: logical, platform: os.platform() + ' ' + os.release(), timeLimitSecondsPerRun: limit, seeds, gpu: 'none (no NVIDIA device; CUDA paths validated with the driver test double only)', scenarios: [] };
for (const [label, name, iters, threads, players, street, exact, sampled, gain] of scenarios) {
  const sc = { label, study: name, players, street, algorithm: 'external-sampling MCCFR, linear averaging (default, unchanged since 3.9)', trainingUpdates: iters, runs: [] };
  for (const seed of seeds) {
    const d = path.join(dir, name + seed);
    execFileSync(process.execPath, [path.join(__dirname, 'study40.js'), src, name, iters, threads, d, cli40, seed], { stdio: 'ignore' });
    execFileSync(process.execPath, [path.join(__dirname, 'study40.js'), src, name, iters, threads, d + '-39', cli39, seed], { stdio: 'ignore' });
    const spec = path.join(d, 'spec.json'), state = path.join(d, 'state'), sameTraining = fs.readFileSync(state).equals(fs.readFileSync(path.join(d + '-39', 'state')));
    const row = { seed, sameTrainingState40and41: sameTraining };
    const both = (mode, q, summarize, bigMax = true) => {
      const base = { ...q, timeLimitMs: limit * 1000, ...(bigMax ? { maxVisits: 2000000000 } : {}) };
      const r39 = call(cli39, mode, spec, state, { ...base, ...(mode === '--ev' ? { threads: 1 } : {}) }), r1 = call(cli40, mode, spec, state, { ...base, threads: 1 }), rN = call(cli40, mode, spec, state, { ...base, threads: logical });
      const pick = r => ({ finished: r.finished, httpStatus: r.httpStatus, wallSeconds: r.wallSeconds, queryMs: r.queryMs, peakRssMiB: r.peakRssMiB, error: r.error, result: summarize(r.json) });
      const res = { v39: pick(r39), v40_1thread: pick(r1) };
      const core = j => mode === '--ev' ? JSON.stringify(j.hands.map(h => [h.ev, h.stdErr, h.samples])) : JSON.stringify(j.seats.map(({ elapsedMs, ...x }) => x));
      if (rN) { res['v40_' + logical + 'threads'] = pick(rN); if (r1.json && rN.json) res.threadsIdentical = core(r1.json) === core(rN.json); }
      if (r39.json && r1.json && (mode === '--gain' || r39.json.method === r1.json.method)) res.numbersIdentical40and41 = core(r39.json) === core(r1.json);
      if (mode === '--ev' && r39.json && r1.json && r39.json.method === 'exact' && r1.json.method === 'exact') res.maxRelativeDifference40vs41 = maxRel(r39.json, r1.json);
      if (r39.finished && r1.finished && r39.wallSeconds > 0) res.speedup1thread = +(r39.wallSeconds / r1.wallSeconds).toFixed(2);
      if (rN && r39.finished && rN.finished) res['speedup' + logical + 'threads'] = +(r39.wallSeconds / rN.wallSeconds).toFixed(2);
      return res;
    };
    if (exact) row.exactEv = both('--ev', { ...exact, method: 'exact' }, evSummary);
    row.sampledEv = both('--ev', { ...sampled, method: 'sampled', seed }, evSummary);
    row.responseGain = both('--gain', { ...gain, seed }, gainSummary, gain.method === 'exact');
    if (exact) {   // deadline: the same exact request with a 100 ms limit
      const q = { ...exact, method: 'exact', timeLimitMs: 100, maxVisits: 2000000000 };
      const a = call(cli39, '--ev', spec, state, { ...q, threads: logical }), b = call(cli40, '--ev', spec, state, { ...q, threads: logical });
      row.deadline100ms = { v40: { finished: a.finished, httpStatus: a.httpStatus, queryMs: a.queryMs, wallSeconds: a.wallSeconds, error: a.error }, v41: { httpStatus: b.httpStatus, queryMs: b.queryMs, wallSeconds: b.wallSeconds, error: b.error } };
      const c = call(cli40, '--ev', spec, state, { ...exact, method: 'exact', timeLimitMs: 600000, maxVisits: 2000000000, threads: logical }, { EM_CANCEL_AFTER_MS: '50' });
      row.cancel50ms = { httpStatus: c.httpStatus, cancelLatencyMs: c.cancelLatencyMs, queryMs: c.queryMs };
    }
    sc.runs.push(row);
    console.log(label, 'seed', seed, JSON.stringify({ exact: row.exactEv && [row.exactEv.v39.wallSeconds, row.exactEv.v40_1thread.wallSeconds, row.exactEv['v40_' + logical + 'threads'] && row.exactEv['v40_' + logical + 'threads'].wallSeconds], sampled: [row.sampledEv.v39.wallSeconds, row.sampledEv.v40_1thread.wallSeconds], gain: [row.responseGain.v39.wallSeconds, row.responseGain.v40_1thread.wallSeconds, row.responseGain['v40_' + logical + 'threads'] && row.responseGain['v40_' + logical + 'threads'].wallSeconds], deadline: row.deadline100ms && [row.deadline100ms.v40.queryMs, row.deadline100ms.v41.queryMs] }));
  }
  report.scenarios.push(sc);
}
fs.writeFileSync(out, JSON.stringify(report, null, 1).replace(/"v40_/g, '"v41_').replace(/"v39"/g, '"v40"').replace(/"speedup1thread"/g, '"speedup41vs40_1thread"'));
fs.rmSync(dir, { recursive: true, force: true });
