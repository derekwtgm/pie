'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { Worker, isMainThread } = require('node:worker_threads'), path = require('node:path'), os = require('node:os');
const RM = require('../src/resource-monitor.js');
const GiB = 1024 ** 3;
const proc = (t, cpuMs, rss) => ({ t, cpuUserMs: cpuMs * 0.9, cpuSystemMs: cpuMs * 0.1, rssBytes: rss, heapUsedBytes: 50e6 });
const base = (o = {}) => RM.buildReport({ samples: [proc(0, 0, 200e6), proc(1000, 1500, 260e6)], workers: [], logicalCpus: 4, totalMemBytes: 16 * GiB, intervalMs: 100, ...o });

test('a plausible run validates and reports units and sources', () => {
  const r = base({ workers: [{ scope: 'worker', worker: 1, t: 1000, heapUsedBytes: 40e6, eventLoopActiveMs: 700 }, { scope: 'worker', worker: 2, t: 1000, heapUsedBytes: 38e6, eventLoopActiveMs: 650 }] });
  assert.equal(r.validation.ok, true, JSON.stringify(r.validation));
  assert.equal(r.process.cpuMs, 1500); assert.equal(r.process.cpuCoresBusy, 1.5); assert.equal(r.process.rssBytesPeak, 260e6);
  assert.equal(r.workerHeapBytesSum, 78e6); assert.equal(r.units.memory, 'bytes'); assert.match(r.sources.workerBusy, /ESTIMATE/);
  assert.equal(r.gpu.measured, false); assert.equal(r.nativeSolverRssBytes, null);
});
test('process CPU is not multiplied by the worker count (the 0.24 defect)', () => {
  // 2 workers on a 4-CPU machine, whole process used 1.5 cores. A naive per-worker sum would say 3.0.
  const r = base({ workers: [1, 2].map((i) => ({ scope: 'worker', worker: i, t: 1000, heapUsedBytes: 30e6, eventLoopActiveMs: 700 })) });
  assert.equal(r.process.cpuCoresBusy, 1.5); assert.ok(r.process.cpuCoresBusy <= r.logicalCpus);
});
test('impossible CPU utilisation is rejected', () => {
  const r = RM.buildReport({ samples: [proc(0, 0, 1e8), proc(1000, 14255, 1e8)], workers: [], logicalCpus: 4, totalMemBytes: 16 * GiB });
  assert.equal(r.validation.ok, false); assert.ok(r.validation.problems.some((p) => p.code === 'cpu-impossible'));
});
test('0.24 benchmark numbers (14 s CPU in 3.5 s on 4 CPUs) are flagged as double counted', () => {
  const r = RM.buildReport({ samples: [proc(0, 0, 1e8), proc(3563, 14255, 1e8)], workers: [1, 2].map((i) => ({ scope: 'worker', worker: i, t: 3563, heapUsedBytes: 3e7, eventLoopActiveMs: 1700 })), logicalCpus: 4, totalMemBytes: 16 * GiB });
  const codes = r.validation.problems.map((p) => p.code); assert.ok(codes.includes('cpu-double-counted'), codes.join());
});
test('double-counted memory: worker heaps larger than the whole resident set', () => {
  const r = base({ workers: [1, 2, 3].map((i) => ({ scope: 'worker', worker: i, t: 1000, heapUsedBytes: 120e6, eventLoopActiveMs: 10 })) });
  assert.ok(r.validation.problems.some((p) => p.code === 'memory-double-counted'));
  const d = RM.describeDoubleCounting([{ rssBytes: 280e6 }, { rssBytes: 280e6 }, { rssBytes: 280e6 }]); assert.equal(d.overstatementFactor, 3);
});
test('RSS above physical memory is impossible', () => { const r = base({ samples: [proc(0, 0, 1e8), proc(1000, 500, 20 * GiB)] }); assert.ok(r.validation.problems.some((p) => p.code === 'memory-impossible')); });
test('negative elapsed time and non-finite values are rejected', () => {
  const neg = base({ samples: [proc(1000, 0, 1e8), proc(500, 100, 1e8)] }); assert.ok(neg.validation.problems.some((p) => p.code === 'negative-elapsed'));
  const nan = base({ samples: [proc(0, 0, 1e8), { ...proc(1000, 100, NaN) }] }); assert.ok(nan.validation.problems.some((p) => p.code === 'invalid-number') || nan.process.rssBytesPeak === 1e8);
  const bad = RM.validate({ elapsedMs: 10, sampleCount: 2, process: { cpuCoresBusy: NaN }, workers: [], logicalCpus: 4 }); assert.ok(bad.problems.some((p) => p.code === 'invalid-number'));
});
test('too few samples, stale metrics and missing worker measurements are reported', () => {
  assert.ok(RM.buildReport({ samples: [proc(0, 0, 1e8)], workers: [], logicalCpus: 4 }).validation.problems.some((p) => p.code === 'too-few-samples'));
  const stale = RM.buildReport({ samples: [proc(0, 0, 1e8), proc(1000, 100, 1e8)], workers: [{ scope: 'worker', worker: 1, t: 1000, heapUsedBytes: 1e7, eventLoopActiveMs: 5 }], logicalCpus: 4, clock: () => 9000, maxAgeMs: 2000 });
  assert.ok(stale.validation.problems.some((p) => p.code === 'stale-metrics'));
  const missing = base({ workers: [{ scope: 'worker', worker: 1, t: 1000, heapUsedBytes: 1e7, eventLoopActiveMs: 5 }], expectedWorkers: 3 }); assert.ok(missing.validation.problems.some((p) => p.code === 'missing-worker-measurement'));
  const noHeap = base({ workers: [{ scope: 'worker', worker: 1, t: 1000, heapUsedBytes: null, eventLoopActiveMs: 5 }] }); assert.ok(noHeap.validation.problems.some((p) => p.code === 'missing-worker-measurement'));
});
test('workers may not submit process-wide figures', () => {
  const m = new RM.RunMonitor({ intervalMs: 0, logicalCpus: 4 });
  assert.throws(() => m.workerReport({ scope: 'worker', worker: 1, rssBytes: 1 }), /process-wide/);
  assert.throws(() => m.workerReport({ scope: 'process', worker: 1 }), /scope/);
  assert.equal(Object.hasOwn(RM.sampleWorkerSelf(1), 'rssBytes'), false); assert.equal(Object.hasOwn(RM.sampleWorkerSelf(1), 'cpuUserMs'), false);
});
test('a real worker-thread run reports a physically possible CPU figure and one RSS', async () => {
  const mon = new RM.RunMonitor({ intervalMs: 20 }).start();
  const code = "const {parentPort,workerData}=require('node:worker_threads');const RM=require(workerData.rm);const t=Date.now();let x=0;while(Date.now()-t<300)x+=Math.sqrt(x+1);parentPort.postMessage(RM.sampleWorkerSelf(workerData.id));";
  const rs = await Promise.all([1, 2, 3, 4, 5, 6].map((id) => new Promise((res, rej) => { const w = new Worker(code, { eval: true, workerData: { rm: path.join(__dirname, '../src/resource-monitor.js'), id } }); w.on('message', res); w.on('error', rej); })));
  rs.forEach((r) => mon.workerReport(r)); const rep = mon.stop();
  assert.equal(rep.workerCount, 6); assert.equal(rep.validation.ok, true, JSON.stringify(rep.validation)); assert.ok(rep.process.cpuCoresBusy <= os.cpus().length * 1.1 + 0.05);
  assert.ok(rep.process.rssBytesPeak > 0 && rep.process.rssBytesPeak < os.totalmem());
  assert.ok(rep.workerBusyMsEstimateSum > 0); assert.ok(rep.sampleCount >= 2);
});

test('multi-table scheduler reports a validated resource section (process CPU/RSS once, tables not multiplied)', async () => {
  const MT = require('../src/multitable.js');
  const src = { decide: async (req) => ({ status: 'unavailable', reason: 'none', format: 'eightmax-decision', version: 1, stateKey: req.stateKey }) };
  const s = new MT.MultiTableScheduler({ tables: 10, handsPerTable: 1, seed: 5, decisionSource: src, allowFallback: true }); const r = await s.run();
  assert.ok(r.resources, 'resources present'); assert.equal(r.resources.validation.ok, true, JSON.stringify(r.resources.validation)); assert.ok(r.resources.process.cpuCoresBusy <= os.cpus().length * 1.1 + 0.05);
  assert.equal(r.resources.workerCount, 0, 'cooperative tables are not workers and report no per-worker figures'); assert.equal(r.resources.gpu.measured, false);
});
