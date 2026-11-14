'use strict';
// EightMax 4.4: interleaved A/B benchmark of two builds (normally the unmodified
// 4.3 mwcli and the 4.4 mwcli) on identical specifications, states, seeds and
// requests. For every repetition each workload is run once per build, in an
// order that rotates with the repetition, so drift of the machine affects both
// builds equally. Game abstractions are identical for both builds (the same
// spec file is given to both).
// Recorded per workload and build: every query time (the engine's own
// steady-clock time around the request, EM_QUERY_TIMING), median / min / max /
// interquartile range, the result values, whether the two builds returned
// identical numbers, the observed device, board counts, and for training the
// wall time, peak RSS, counters and the SHA-256 of the saved state.
// usage: node tools/bench44.js <out.json> <reps> labelA=mwcliA labelB=mwcliB [--quick]
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const E = require('./loadlib'); for (const l of ['lib_runouts', 'lib_wide', 'lib_river', 'lib_pushfold', 'lib_explorer']) require('../web/' + l);
const args = process.argv.slice(2), quick = args.includes('--quick'), [out, repsArg, ...buildArgs] = args.filter(a => !a.startsWith('--'));
const reps = +repsArg, builds = buildArgs.map(b => { const i = b.indexOf('='); return { label: b.slice(0, i), cli: b.slice(i + 1) }; });
const fixtures = path.join(__dirname, '..', '..', 'validation', '4.0', 'fixtures');
const base = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128 };
const STACKS8 = [30, 22, 15, 40, 9, 18, 25, 12], PAY8 = [30, 20, 14, 11, 9, 7, 5, 4], FIXED8 = ['AsAh', 'KsKh', 'QsQh', 'JsJh', 'TsTh', '9s9h', '8s8h', '7s7h'];
const R3 = ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc'];
const games = {
  huRiver: { board: 'Ks8d5h2c2s', common: 10, stacks: [20, 20], ranges: R3.slice(0, 2), streets: { river: { bets: '50,a', raises: 'a', maxBets: 2 } } },
  river3: { board: 'Ks8d5h2c2s', common: 6, stacks: [4, 12, 30], ranges: R3, streets: { river: { bets: '75,a', raises: 'a', maxBets: 2 } } },
  flop6: { board: 'Td7c2h', dealt: 8, common: 1.5, stacks: [20, 35, 8, 50, 14, 3], prior: Array(6).fill(2.5), folded: [1, 2.5], ranges: ['AhTh,7s7d', 'KdTs,9c8c', 'QsQd,Ac7h', 'JhTc,6s5s', 'AdKc,2s2d', '8h8d,As2c'], streets: { flop: { bets: 'a', raises: '', maxBets: 1 } } },
  bubble4: { preflop: { mode: 'shove' }, dealt: 4, common: 0, board: '', stacks: [12, 7, 20, 4], ranges: ['AsAh,7c2d:0.5', 'KsKh:0.75,8c3d', 'QsQh,6d5d', 'JsJh:0.5,9s8s'], icm: { payouts: [50, 30, 20] }, batchDeals: 4, actionStreams: 'deal' },
  push8: { preflop: { mode: 'shove' }, board: '', dealt: 8, common: 0, stacks: STACKS8, ranges: FIXED8, icm: { payouts: PAY8 }, batchDeals: 4, actionStreams: 'deal' },
  shortAllIn: { preflop: { mode: 'shove' }, board: '', dealt: 8, common: 0, stacks: [6, 4, 9, 3, 12, 5, 8, 7], ranges: FIXED8, batchDeals: 4, actionStreams: 'deal' },
  linked8: { preflop: { mode: 'linked', opens: '2.2,a', raises: 'a', maxBets: 2 }, board: '', dealt: 8, common: 0, stacks: STACKS8, ranges: Array(8).fill('random'), icm: { payouts: PAY8 }, streets: { flop: { bets: '50', raises: '', maxBets: 1 }, turn: { bets: 'a', raises: '', maxBets: 1 }, river: { bets: 'a', raises: '', maxBets: 1 } }, batchDeals: 4, actionStreams: 'deal' },
  wide3: { board: 'Ks8d5h', common: 6, stacks: [20, 30, 45], ranges: Array(3).fill('22+,A2s+,K7s+,Q9s+,J9s+,T9s,A8o+,KTo+,QJo:0.8'), streets: { flop: { bets: '50,a', raises: 'a', maxBets: 2 }, turn: { bets: '75', raises: '', maxBets: 1 }, river: { bets: 'a', raises: '', maxBets: 1 } } },
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em44-bench-'));
const EX = { timeLimitMs: 600000, maxVisits: 2000000000 };
function prepare(name, iterations) {   // one spec and one state (trained by the FIRST build) shared by both builds
  const d = path.join(dir, name); fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 'spec.json'), JSON.stringify(E.MultiwayGame({ ...base, ...games[name], privateSeed: 4 }).nativeSpec()));
  cp.execFileSync(builds[0].cli, [path.join(d, 'spec.json'), iterations, 2, path.join(d, 'state'), 512].map(String));
  return { spec: path.join(d, 'spec.json'), state: path.join(d, 'state'), d };
}
const fx = { spec: path.join(fixtures, 'push8-icm.spec.json'), state: path.join(fixtures, 'push8-icm.state'), d: dir };
const G = {}; for (const [n, it] of [['huRiver', 400], ['river3', 400], ['flop6', 300], ['bubble4', 200], ['linked8', 20], ['wide3', 60], ['shortAllIn', 200]]) G[n] = prepare(n, it);
// [name, description, study, mode, request, env]
const W = [
  ['exact-ev-final8-1t', 'Exact action EV, eight-player final-table ICM (4.0 fixture), 1 thread', fx, '--ev', { path: [], hands: [0], method: 'exact', device: 'cpu', threads: 1, ...EX }],
  ['exact-ev-final8-2t', 'same, 2 threads', fx, '--ev', { path: [], hands: [0], method: 'exact', device: 'cpu', threads: 2, ...EX }],
  ['exact-ev-final8-4t', 'same, 4 threads', fx, '--ev', { path: [], hands: [0], method: 'exact', device: 'cpu', threads: 4, ...EX }],
  ['exact-gain-final8-4t', 'Exact response gains, all eight seats, final-table ICM, 4 threads', fx, '--gain', { method: 'exact', seats: [0, 1, 2, 3, 4, 5, 6, 7], threads: 4, ...EX }],
  ['exact-gain-bubble4-4t', 'Exact response gains, four-player bubble ICM, weighted ranges, 4 threads', G.bubble4, '--gain', { method: 'exact', threads: 4, ...EX }],
  ['exact-gain-flop6-4t', 'Exact response gains, six-player flop, multiway all-ins, 4 threads', G.flop6, '--gain', { method: 'exact', threads: 4, ...EX }],
  ['exact-gain-shortallin8-4t', 'Exact response gains, eight-player short-stack all-ins (3-12 bb), chip EV, 4 threads', G.shortAllIn, '--gain', { method: 'exact', seats: [0, 3, 7], threads: 4, ...EX }],
  ['exact-ev-river3-2t', 'Exact range EV, three-player river with side pots, 2 threads', G.river3, '--ev', { path: [], hands: [0], range: true, method: 'exact', threads: 2, ...EX }],
  ['exact-gain-huriver-2t', 'Exact best response, heads-up river, 2 threads', G.huRiver, '--gain', { method: 'exact', threads: 2, ...EX }],
  ['sampled-ev-linked8-4t', 'Sampled range EV, eight-player linked preflop-to-river ICM, 3,000 samples (complete), 4 threads', G.linked8, '--ev', { path: [], hands: [], range: true, method: 'sampled', samples: 3000, seed: 5, threads: 4, timeLimitMs: 600000 }],
  ['sampled-ev-linked8-1t', 'same, 1 thread, 1,000 samples', G.linked8, '--ev', { path: [], hands: [], range: true, method: 'sampled', samples: 1000, seed: 5, threads: 1, timeLimitMs: 600000 }],
  ['sampled-ev-wide3-4t', 'Sampled range EV, three-player flop with wide weighted ranges (about 150 combos a seat), 20,000 samples, 4 threads', G.wide3, '--ev', { path: [], hands: [], range: true, method: 'sampled', samples: 20000, seed: 5, threads: 4, timeLimitMs: 600000 }],
  ['sampled-gain-linked8-4t', 'Sampled one-decision response gains, eight-player linked ICM, seats 0 and 3, 256 samples, 4 threads', G.linked8, '--gain', { method: 'sampled', seats: [0, 3], samples: 256, seed: 5, threads: 4, timeLimitMs: 600000 }],
  ['deadline-250-linked8-4t', 'Sampled EV stopped by a 250 ms limit (hand, then range), 4 threads: time is the response time', G.linked8, '--ev', { path: [], hands: [3], range: true, method: 'sampled', samples: 2000000, seed: 5, threads: 4, timeLimitMs: 250 }],
  ['throughput-3000-linked8-4t', 'Sampled EV for 3 s, 4 threads: time is the response time, medianSamples the samples completed (more = faster)', G.linked8, '--ev', { path: [], hands: [3], method: 'sampled', samples: 2000000, seed: 5, threads: 4, timeLimitMs: 3000 }],
  ['throughput-3000-linked8-1t', 'same, 1 thread', G.linked8, '--ev', { path: [], hands: [3], method: 'sampled', samples: 2000000, seed: 5, threads: 1, timeLimitMs: 3000 }],
  ['cancel-150-linked8-4t', 'Sampled EV cancelled after 150 ms, 4 threads: time is the cancellation latency', G.linked8, '--ev', { path: [], hands: [3], range: true, method: 'sampled', samples: 2000000, seed: 5, threads: 4, timeLimitMs: 600000 }, { EM_CANCEL_AFTER_MS: '150' }],
].filter(w => !quick || /final8-4t|deadline|huriver|throughput/.test(w[0]));
const T = [   // training: [name, description, game, sampled deals (iterations x batch), threads]
  ['train-final8', 'Training, eight-player final-table ICM push/fold, 20,000 updates, 4 threads', 'push8', 20000, 4],
  ['train-flop6', 'Training, six-player flop, 20,000 updates, 4 threads', 'flop6', 20000, 4],
  ['train-linked8', 'Training, eight-player linked preflop-to-river ICM, 300 updates, 4 threads', 'linked8', 300, 4],
].filter(() => !quick);
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const valuesOf = j => !j ? null : j.seats ? j.seats.map(s => typeof s.gain === 'object' && s.gain ? s.gain.mean : s.gain) : [...(j.hands || []).map(h => h.ev), j.range && j.range.ev].filter(Boolean);
const rows = [];
for (let r = 0; r < reps; r++) {
  for (const [name, desc, S, mode, q, env] of W) for (let k = 0; k < builds.length; k++) {
    const b = builds[(k + r) % builds.length], f = path.join(dir, 'q.json'); fs.writeFileSync(f, JSON.stringify(q));
    const p = cp.spawnSync(b.cli, [mode, S.spec, S.state, f], { encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, EM_QUERY_TIMING: '1', ...(env || {}) } });
    let timing = null, j = null; try { timing = JSON.parse(p.stderr.trim().split('\n')[0]); } catch { } try { j = JSON.parse(p.stdout); } catch { }
    const x = j && j.execution || {};
    rows.push({ kind: 'query', workload: name, description: desc, build: b.label, rep: r, ms: timing ? (timing.cancelLatencyMs !== undefined ? timing.cancelLatencyMs : timing.queryMs) : null, httpStatus: timing && timing.status, status: j && j.status, values: valuesOf(j),
      stdErr: j && j.range && j.range.stdErr || (j && j.hands && j.hands[0] && j.hands[0].stdErr) || null, samples: j && (j.range && j.range.samples || j.hands && j.hands[0] && j.hands[0].samples) || null,
      observedDevice: x.observedDevice, cpuBoards: x.cpuBoards, gpuBoards: x.gpuBoards, peakEvaluationMiB: x.peakEvaluationMiB, threads: q.threads, method: q.method, seed: q.seed === undefined ? null : q.seed });
  }
  for (const [name, desc, game, updates, threads] of T) for (let k = 0; k < builds.length; k++) {
    const b = builds[(k + r) % builds.length], d = path.join(dir, 'train-' + name + '-' + b.label); fs.mkdirSync(d, { recursive: true });
    const spec = path.join(d, 'spec.json'), st = path.join(d, 'state'); fs.writeFileSync(spec, JSON.stringify(E.MultiwayGame({ ...base, ...games[game], privateSeed: 9 }).nativeSpec()));
    const info = JSON.parse(cp.execFileSync(b.cli, [spec, updates, threads, st, 512].map(String), { encoding: 'utf8', maxBuffer: 1 << 26 }));
    rows.push({ kind: 'training', workload: name, description: desc, build: b.label, rep: r, ms: info.wallSeconds * 1000, updates: info.iterations, sampledDeals: info.trainingDeals, stateVisits: info.stateVisits, rng: info.rng, rows: info.rows, peakRssMiB: info.processPeakRssMiB, devicePath: info.devicePath, stateSha256: sha(st), threads, seed: 9, algorithm: info.algorithm, weighting: info.weighting });
  }
  process.stderr.write('repetition ' + (r + 1) + '/' + reps + '\n');
}
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
const summary = [];
for (const name of [...W.map(w => w[0]), ...T.map(t => t[0])]) {
  const per = {}; let identical = true, ref = null, hashes = new Set();
  for (const b of builds) {
    const rs = rows.filter(x => x.workload === name && x.build === b.label), ms = rs.map(x => x.ms).filter(x => x !== null);
    const smp = rs.map(x => x.samples).filter(x => typeof x === 'number');
    per[b.label] = { n: ms.length, medianMs: q(ms, 0.5), minMs: Math.min(...ms), maxMs: Math.max(...ms), iqrMs: q(ms, 0.75) - q(ms, 0.25), medianSamples: smp.length ? q(smp, 0.5) : null, status: [...new Set(rs.map(x => x.status || x.httpStatus || 'ok'))] };
    for (const x of rs) { if (x.kind === 'training') hashes.add(x.stateSha256); else { const v = JSON.stringify(x.values); if (ref === null) ref = v; else if (v !== ref) identical = false; } }
  }
  const a = per[builds[0].label], b = per[builds[builds.length - 1].label], kind = rows.find(x => x.workload === name).kind;
  summary.push({ workload: name, description: rows.find(x => x.workload === name).description, kind, builds: per, ratio: +(b.medianMs / a.medianMs).toFixed(3), ratioMeaning: builds[builds.length - 1].label + ' median / ' + builds[0].label + ' median (below 1 = faster)',
    identicalResults: kind === 'training' ? hashes.size === 1 : /deadline|cancel|throughput/.test(name) ? null : identical, identicalNote: kind === 'training' ? 'SHA-256 of the saved state over all runs of both builds' : /deadline|cancel|throughput/.test(name) ? 'time-stopped runs are not comparable value for value' : 'printed values of every run of both builds' });
}
fs.writeFileSync(out, JSON.stringify({ tool: 'bench44', generated: new Date().toISOString(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, platform: os.platform() + ' ' + os.arch(), builds, repetitions: reps, order: 'interleaved, rotating with the repetition', summary, rows }, null, 1));
fs.rmSync(dir, { recursive: true, force: true });
for (const s of summary) console.log(s.workload.padEnd(28), builds.map(b => b.label + ' ' + s.builds[b.label].medianMs.toFixed(1) + ' ms [' + s.builds[b.label].minMs.toFixed(1) + '-' + s.builds[b.label].maxMs.toFixed(1) + ']').join('   '), ' ratio', s.ratio, ' identical', s.identicalResults, s.builds[builds[0].label].medianSamples !== null && /throughput/.test(s.workload) ? ' samples ' + builds.map(b => s.builds[b.label].medianSamples).join(' vs ') : '');
