'use strict';
/* 0.24 multi-table benchmarks. Three separate measurements, never mixed:
 *   A. lookup  : structured feed, precomputed-strategy lookups (the 0.23 scheduler, unchanged)       -> tools/multitable-benchmark.cjs
 *   B. pipeline: every decision goes through render -> capture -> recognise -> reconstruct -> execute -> acknowledge;
 *                one thread (cooperative) versus N worker threads
 *   C. solving : on-demand postflop studies (actual solving) in-thread versus a worker-thread pool
 * SIMULATED TABLES on this machine. Not real-client and not Windows-target-hardware numbers. */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { Worker } = require('node:worker_threads');
const { runTables } = require('./pipeline-worker.cjs');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const hands = +(args.hands || 4), seed = +(args.seed || 4127), workers = +(args.workers || 4), out = args.out, cli = process.env.EIGHTMAX_TEST_CLI || null;
const pct = (a, p) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)]; };
const RM = require('../src/resource-monitor.js');
const summarise = (parts, res) => {
  const wall = Math.max(...parts.map((p) => p.wallMs)), completed = parts.reduce((n, p) => n + p.reports.reduce((m, r) => m + r.completed, 0), 0);
  const cycle = parts.flatMap((p) => p.reports.map((r) => r.latencyMs.cycle)).filter((c) => c.n), actions = parts.reduce((n, p) => n + p.reports.reduce((m, r) => m + r.totals.solverActions + r.totals.scriptedActions, 0), 0);
  return { wallMs: wall, handsCompleted: completed, handsPerSecond: completed / (wall / 1000), actions, actionsPerSecond: actions / (wall / 1000), resources: res,
    decisionCycleMsP50: cycle.length ? pct(cycle.map((c) => c.p50), 50) : null, decisionCycleMsP95Worst: cycle.length ? Math.max(...cycle.map((c) => c.p95)) : null, suspendedHands: parts.reduce((n, p) => n + p.reports.reduce((m, r) => m + r.totals.suspended, 0), 0), ackMismatches: parts.reduce((n, p) => n + p.reports.reduce((m, r) => m + r.totals.ackMismatches, 0), 0), rejectedFrames: parts.reduce((n, p) => n + p.reports.reduce((m, r) => m + r.totals.rejectedFrames, 0), 0) };
};
function inWorker(job) { return new Promise((res, rej) => { const w = new Worker(path.join(__dirname, 'pipeline-worker.cjs'), { workerData: { job } }); w.on('message', (m) => (m.ok ? res(m.result) : rej(new Error(m.error)))); w.on('error', rej); }); }

async function main() {
  const doc = { format: 'eightmax-multitable-benchmark', version: 2, appVersion: require('../src/engine.js').VERSION, generatedAt: new Date().toISOString(), classification: 'SIMULATED TABLES on this machine; not real-client and not Windows target hardware; no GPU',
    machine: { platform: process.platform, arch: process.arch, node: process.version, cpu: os.cpus()[0] && os.cpus()[0].model, logicalCpus: os.cpus().length, totalMemBytes: os.totalmem() }, handsPerTable: hands, seed, pipeline: {}, solving: {} };
  // B. pipeline (scripted decisions: isolates capture+recognition+reconstruction+execution cost; solver not involved)
  if (args.only !== 'solving') for (const tables of [1, 2, 5, 8, 10]) {
    const mon1 = new RM.RunMonitor({ intervalMs: 100 }).start();
    const part1 = await runTables({ tables: Array.from({ length: tables }, (_, i) => i + 1), hands, seed, workerId: 'main' }); mon1.workerReport(part1.self);
    const single = summarise([part1], mon1.stop());
    const groups = Array.from({ length: Math.min(workers, tables) }, () => []); for (let i = 1; i <= tables; i++) groups[(i - 1) % groups.length].push(i);
    const monN = new RM.RunMonitor({ intervalMs: 100 }).start();
    const partsN = await Promise.all(groups.map((g, gi) => inWorker({ tables: g, hands, seed, workerId: gi + 1 }))); partsN.forEach((x) => monN.workerReport(x.self));
    const par = summarise(partsN, monN.report({ workers: groups.length })); monN.stop();
    doc.pipeline[tables] = { oneThread: single, workerThreads: { workers: groups.length, ...par }, speedup: single.wallMs / par.wallMs };
    process.stderr.write('pipeline ' + tables + ' tables: 1 thread ' + Math.round(single.wallMs) + ' ms, ' + groups.length + ' workers ' + Math.round(par.wallMs) + ' ms (x' + (single.wallMs / par.wallMs).toFixed(2) + ')\n');
  }
  // C. actual solving
  if (cli) {
    const solver = { kind: 'postflop-only', cli, postIterations: 20000 }, SF = require('./solver-factory.cjs'), { WorkerThreadSource } = require('../src/solver-pool.js');
    const EM = require('../src/engine.js'), FH = require('../src/full-hand.js'), SS = require('../src/solver-service.js');
    const reqs = [], probe = new (require('../src/solver-tree.js').PostflopStudySource)({ EM: require('../tests/load-solver.cjs'), adapter: require('../src/study-adapter.js'), iterations: 10 }); const rec = { decide: async (req) => { if (req.board.length >= 3 && reqs.length < 400 && !probe.context(req).error) reqs.push(req); return { status: 'unavailable', reason: 'collecting' }; } };
    const p = new FH.SingleTablePipeline({ tableId: 1, client: new FH.OfflineClient(new EM.Table(1, 99)), vision: FH.makeVision(1), decisionSource: rec, allowScripted: true, seed: 5, stopOnSuspend: false }); await p.run(+(args.collectHands || 60));
    const uniq = new Map(); for (const r of reqs) uniq.set(r.table + '/' + r.hand + '/' + r.street, r); const list = [...uniq.values()].slice(0, +(args.requests || 16));
    const timeOne = async (src) => { const lat = []; const t0 = Date.now(); await Promise.all(list.map(async (r, i) => { const s = Date.now(); const d = await src.decide({ ...r, table: (i % 10) + 1 }); lat.push(Date.now() - s); return d; })); return { requests: list.length, wallMs: Date.now() - t0, latencyMsP50: pct(lat, 50), latencyMsP95: pct(lat, 95), latencyMsMax: Math.max(...lat) }; };
    const inThread = await SF.createSource({ ...solver, cli: undefined, postIterations: 2500 }); // JS reference trainer on this thread (blocks the thread while training)
    doc.solving.requestsFromRealHands = list.length; doc.solving.jsReferenceInThread = { iterations: 2500, ...(await timeOne(inThread)) };
    const nat = await SF.createSource(solver); doc.solving.nativeCliAsyncInThread = { iterations: 20000, ...(await timeOne(nat)) };
    for (const size of [1, 2, 4]) { const pool = new WorkerThreadSource({ factory: path.join(__dirname, 'solver-factory.cjs'), factoryOptions: { ...solver, cli: undefined, postIterations: 2500 }, size, jobTimeoutMs: 120000 }); await pool.ready(); doc.solving['jsReferenceWorkerThreads' + size] = { iterations: 2500, ...(await timeOne(pool)), pool: pool.info() }; await pool.close(); }
    process.stderr.write('solving: ' + JSON.stringify(Object.fromEntries(Object.entries(doc.solving).map(([k, v]) => [k, v && v.wallMs])).slice) + '\n');
  } else doc.solving = { skipped: 'EIGHTMAX_TEST_CLI not set; on-demand native solving not measured' };
  const text = JSON.stringify(doc, null, 2); if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, text); } else console.log(text);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
