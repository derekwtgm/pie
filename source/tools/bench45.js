'use strict';
// EightMax 4.5: memory- and training-focused A/B measurements of two builds (normally the
// unmodified 4.4 mwcli and the 4.5 mwcli). It complements tools/bench44.js (17 evaluation
// workloads and 3 training workloads, unchanged, run with the same two builds) with what 4.5
// changed:
//   A. COVERAGE MEMORY. Sampled range EV on the eight-player linked preflop-to-river ICM study
//      with coverageMiB 1, 2, 8, 32 and 64 and 1 / 4 threads. Recorded per build: the engine's
//      own figures (4.5: coverage.memory budget / peak / table / retired generations / filters;
//      4.4 reports only execution.coverageSetBytes, the nominal slot bytes), the process peak
//      RSS (tools/peak_rss.c, wait4), time, counts, and the EV bit patterns (must be identical between
//      builds: the coverage budget never changes a value).
//   B. BUDGET EXHAUSTION. The same request with a budget far below the keys visited: status,
//      lower-bound label, time against the uncapped run (no extra wait from the budget code).
//   C. ICM TRAINING THROUGHPUT. Eight-player final-table push/fold, four-player bubble and the
//      eight-player linked study, 1 and 4 threads: wall time, deals per second, peak RSS and the
//      SHA-256 of the saved state (must be identical between builds: the 4.5 ICM kernel is
//      bit-identical).
// Every repetition runs each build once, in an order that rotates with the repetition.
// usage: node tools/bench45.js <out.json> <reps> labelA=mwcliA labelB=mwcliB [--quick]
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const E = require('./loadlib'); for (const l of ['lib_runouts', 'lib_wide', 'lib_river', 'lib_pushfold', 'lib_explorer']) require('../web/' + l);
const args = process.argv.slice(2), quick = args.includes('--quick'), [out, repsArg, ...buildArgs] = args.filter(a => !a.startsWith('--'));
const reps = +repsArg, builds = buildArgs.map(b => { const i = b.indexOf('='); return { label: b.slice(0, i), cli: b.slice(i + 1) }; });
if (!out || !(reps >= 1) || builds.length < 1) { console.error('usage: node tools/bench45.js <out.json> <reps> labelA=mwcliA [labelB=mwcliB] [--quick]'); process.exit(2); }
const base = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128 };
const STACKS8 = [30, 22, 15, 40, 9, 18, 25, 12], PAY8 = [30, 20, 14, 11, 9, 7, 5, 4], FIXED8 = ['AsAh', 'KsKh', 'QsQh', 'JsJh', 'TsTh', '9s9h', '8s8h', '7s7h'];
const games = {
  push8: { preflop: { mode: 'shove' }, board: '', dealt: 8, common: 0, stacks: STACKS8, ranges: FIXED8, icm: { payouts: PAY8 }, batchDeals: 4, actionStreams: 'deal' },
  bubble4: { preflop: { mode: 'shove' }, dealt: 4, common: 0, board: '', stacks: [12, 7, 20, 4], ranges: ['AsAh,7c2d:0.5', 'KsKh:0.75,8c3d', 'QsQh,6d5d', 'JsJh:0.5,9s8s'], icm: { payouts: [50, 30, 20] }, batchDeals: 4, actionStreams: 'deal' },
  linked8: { preflop: { mode: 'linked', opens: '2.2,a', raises: 'a', maxBets: 2 }, board: '', dealt: 8, common: 0, stacks: STACKS8, ranges: Array(8).fill('random'), icm: { payouts: PAY8 }, streets: { flop: { bets: '50', raises: '', maxBets: 1 }, turn: { bets: 'a', raises: '', maxBets: 1 }, river: { bets: 'a', raises: '', maxBets: 1 } }, batchDeals: 4, actionStreams: 'deal' },
  linked8chip: { preflop: { mode: 'linked', opens: '2.2,a', raises: 'a', maxBets: 2 }, board: '', dealt: 8, common: 0, stacks: STACKS8, ranges: Array(8).fill('random'), streets: { flop: { bets: '50', raises: '', maxBets: 1 }, turn: { bets: 'a', raises: '', maxBets: 1 }, river: { bets: 'a', raises: '', maxBets: 1 } }, batchDeals: 4, actionStreams: 'deal' },
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em45-bench-'));
const specOf = name => { const f = path.join(dir, name + '.spec.json'); if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify(E.MultiwayGame({ ...base, ...games[name], privateSeed: 4 }).nativeSpec())); return f; };
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
// Peak RSS of each child process: tools/peak_rss.c (wait4), compiled once; null if no C compiler.
const rssTool = (() => { const exe = path.join(dir, 'peak_rss'); const r = cp.spawnSync('gcc', ['-O2', path.join(__dirname, 'peak_rss.c'), '-o', exe]); return r.status === 0 ? exe : null; })();
// Runs one process; returns stdout JSON, the engine's query timing (stderr line 1) and the peak RSS in MiB.
function run(cli, argv, env = {}) {
  const cmd = rssTool || cli, a = rssTool ? [cli, ...argv] : argv;
  const t0 = process.hrtime.bigint(), p = cp.spawnSync(cmd, a.map(String), { encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, EM_QUERY_TIMING: '1', ...env } }), wallMs = Number(process.hrtime.bigint() - t0) / 1e6;
  let json = null, timing = null; try { json = JSON.parse(p.stdout); } catch { } try { timing = JSON.parse((p.stderr || '').trim().split('\n')[0]); } catch { }
  const m = /peakRssKiB=(\d+)/.exec(p.stderr || '');
  return { json, timing, wallMs, peakRssMiB: m ? +m[1] / 1024 : null, status: p.status };
}
const med = v => { const s = v.filter(x => x != null).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const spread = v => { const s = v.filter(x => x != null).sort((a, b) => a - b); return s.length ? { median: med(s), min: s[0], max: s[s.length - 1], n: s.length } : null; };
const report = { tool: 'bench45', generated: new Date().toISOString(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, reps, builds: builds.map(b => b.label), coverage: [], exhaustion: [], training: [],
  note: 'Linux host, CPU only. peakRssMiB is the whole process (study, showdown tables, coverage). 4.4 does not report a coverage ledger: its coverageSetBytes is the nominal slot memory, not the bytes allocated (tests/coverage45.cpp measures those against the archived 4.4 header).' };
// ---------------------------------------------------------------- A, B: coverage memory
{
  const spec = specOf('linked8'), state = path.join(dir, 'linked8.state');
  cp.execFileSync(builds[0].cli, [spec, 20, 2, state, 512].map(String));
  const q = path.join(dir, 'q.json');
  for (const mib of quick ? [1, 64] : [1, 2, 8, 32, 64]) for (const threads of quick ? [4] : [1, 4]) {
    const rows = Object.fromEntries(builds.map(b => [b.label, []]));
    for (let r = 0; r < reps; r++) for (let k = 0; k < builds.length; k++) {
      const b = builds[(k + r) % builds.length];
      fs.writeFileSync(q, JSON.stringify({ path: [], hands: [3], range: true, method: 'sampled', samples: 30000, seed: 5, timeLimitMs: 600000, threads, coverageMiB: mib }));
      const x = run(b.cli, ['--ev', spec, state, q]), c = x.json && x.json.coverage, m = c && c.memory;
      rows[b.label].push({ queryMs: x.timing && x.timing.queryMs, peakRssMiB: x.peakRssMiB, status: x.json && x.json.status, kind: c && c.distinctCountKind, distinct: c && c.distinctInformationSets, exactKeyLimit: c && c.capacity.exactKeyLimit,
        coverageSetBytes: x.json && x.json.execution.coverageSetBytes, ledger: m ? { budgetBytes: m.budgetBytes, peakBytes: m.peakBytes, tableBytes: m.tableBytes, retiredGenerationBytes: m.retiredGenerationBytes, workerFilterBytes: m.workerFilterBytes, generations: m.generations, status: m.status, withinBudget: m.withinBudget } : null,
        evBits: x.json && JSON.stringify(x.json.range.evBits) });
    }
    const entry = { coverageMiB: mib, budgetBytes: mib << 20, threads, builds: {} };
    for (const b of builds) { const v = rows[b.label]; entry.builds[b.label] = { queryMs: spread(v.map(x => x.queryMs)), peakRssMiB: spread(v.map(x => x.peakRssMiB)), kind: v[0].kind, distinct: [...new Set(v.map(x => x.distinct))], exactKeyLimit: v[0].exactKeyLimit, coverageSetBytes: v[0].coverageSetBytes,
      ledgerPeakBytes: v[0].ledger ? Math.max(...v.map(x => x.ledger.peakBytes)) : null, ledger: v[0].ledger, withinBudget: v[0].ledger ? v.every(x => x.ledger.peakBytes <= x.ledger.budgetBytes) : null }; }
    entry.evBitsIdenticalAcrossBuilds = new Set(Object.values(rows).flat().map(x => x.evBits)).size === 1;
    report.coverage.push(entry);
    console.log(`coverage ${String(mib).padStart(2)} MiB ${threads} thr  ` + builds.map(b => { const e = entry.builds[b.label]; return `${b.label}: ${e.queryMs.median.toFixed(0)} ms, rss ${e.peakRssMiB ? e.peakRssMiB.median.toFixed(1) : '?'} MiB, ${e.kind} ${e.distinct}, ` + (e.ledger ? `ledger peak ${e.ledgerPeakBytes} of ${e.ledger.budgetBytes}` : `slot bytes ${e.coverageSetBytes}`); }).join(' | ') + `  ev identical: ${entry.evBitsIdenticalAcrossBuilds}`);
  }
  // B: exhaustion against the uncapped run, same build (the budget code must not add a wait)
  for (const b of builds) {
    const t = { capped: [], uncapped: [] }; let st = null;
    for (let r = 0; r < reps; r++) for (const [name, mib] of r % 2 ? [['uncapped', 64], ['capped', 1]] : [['capped', 1], ['uncapped', 64]]) {
      fs.writeFileSync(q, JSON.stringify({ path: [], hands: [3], range: true, method: 'sampled', samples: 30000, seed: 5, timeLimitMs: 600000, threads: 4, coverageMiB: mib }));
      const x = run(b.cli, ['--ev', spec, state, q]); t[name].push(x.timing && x.timing.queryMs); if (name === 'capped') st = x.json && x.json.coverage;
    }
    report.exhaustion.push({ build: b.label, cappedMs: spread(t.capped), uncappedMs: spread(t.uncapped), cappedOverUncapped: med(t.capped) / med(t.uncapped), kind: st && st.distinctCountKind, status: st && st.memory ? st.memory.status : '(not reported by this build)', lowerBound: st && st.distinctInformationSets, estimate: st && st.distinctEstimates && st.distinctEstimates.distinctInformationSets });
    console.log(`exhaustion ${b.label}: capped (1 MiB) ${med(t.capped).toFixed(0)} ms vs uncapped ${med(t.uncapped).toFixed(0)} ms`);
  }
}
// ---------------------------------------------------------------- C: training throughput
for (const [name, desc, updates] of [['push8', 'Eight-player final-table ICM push/fold (fixed hands)', quick ? 20000 : 100000], ['bubble4', 'Four-player ICM bubble push/fold (weighted ranges)', quick ? 20000 : 100000], ['linked8', 'Eight-player linked preflop-to-river, ICM, random ranges', quick ? 500 : 3000], ['linked8chip', 'The same study with chip EV (no ICM evaluation: control)', quick ? 500 : 3000]])
  for (const threads of quick ? [1] : [1, 4]) {
    const spec = specOf(name), rows = Object.fromEntries(builds.map(b => [b.label, []]));
    for (let r = 0; r < reps; r++) for (let k = 0; k < builds.length; k++) {
      const b = builds[(k + r) % builds.length], st = path.join(dir, 'train.state');
      const x = run(b.cli, [spec, updates, threads, st, 512]), j = x.json || {};
      rows[b.label].push({ wallSeconds: j.wallSeconds, traverseSeconds: j.seconds && j.seconds.traverse, deals: j.trainingDeals, peakRssMiB: x.peakRssMiB, tableMiB: j.tableMiB, sha256: fs.existsSync(st) ? sha(st) : null, threadsUsed: j.threads });
      fs.rmSync(st, { force: true });
    }
    const entry = { game: name, description: desc, updates, sampledDeals: rows[builds[0].label][0].deals, threads, builds: {} };
    for (const b of builds) { const v = rows[b.label]; entry.builds[b.label] = { wallSeconds: spread(v.map(x => x.wallSeconds)), traverseSeconds: spread(v.map(x => x.traverseSeconds)), dealsPerSecond: v[0].deals / med(v.map(x => x.wallSeconds)), peakRssMiB: spread(v.map(x => x.peakRssMiB)), tableMiB: v[0].tableMiB, sha256: [...new Set(v.map(x => x.sha256))] }; }
    entry.stateIdenticalAcrossBuilds = new Set(Object.values(rows).flat().map(x => x.sha256)).size === 1;
    if (builds.length === 2) entry.speedup = entry.builds[builds[0].label].wallSeconds.median / entry.builds[builds[1].label].wallSeconds.median;
    report.training.push(entry);
    console.log(`train ${name.padEnd(11)} ${threads} thr  ` + builds.map(b => `${b.label}: ${entry.builds[b.label].wallSeconds.median.toFixed(3)} s (${entry.builds[b.label].wallSeconds.min.toFixed(3)}-${entry.builds[b.label].wallSeconds.max.toFixed(3)})`).join(' | ') + (entry.speedup ? `  speed-up ${entry.speedup.toFixed(3)}x` : '') + `  state identical: ${entry.stateIdenticalAcrossBuilds}`);
  }
fs.writeFileSync(out, JSON.stringify(report, null, 1)); fs.rmSync(dir, { recursive: true, force: true });
console.log('wrote', out);
