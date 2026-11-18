'use strict';
/* Worker-thread body for the multi-table image-pipeline benchmark: runs `tables` complete single-table pipelines
 * (render -> capture -> recognise -> reconstruct -> decide -> execute -> acknowledge) and reports per-table results. */
const { parentPort, workerData, isMainThread } = require('node:worker_threads');
const path = require('node:path');
const root = path.join(__dirname, '..');
async function runTables(o) {
  const EM = require(path.join(root, 'src/engine.js')), FH = require(path.join(root, 'src/full-hand.js')), ST = require(path.join(root, 'src/solver-tree.js'));
  let src = { decide: async () => ({ status: 'unavailable', reason: 'no solver in this run' }) };
  if (o.solver) src = await require(path.join(root, 'tools/solver-factory.cjs')).createSource(o.solver);
  const pipes = o.tables.map((id) => new FH.SingleTablePipeline({ tableId: id, client: new FH.OfflineClient(new EM.Table(id, o.seed + id * 139), o.stacks === 'variable' ? { stackPolicy: FH.variableStacks } : {}), vision: FH.makeVision(id), decisionSource: src, allowScripted: true, seed: o.seed + id, stopOnSuspend: false }));
  const RM = require(path.join(root, 'src/resource-monitor.js')), t0 = process.hrtime.bigint();
  const reports = await Promise.all(pipes.map((p) => p.run(o.hands)));
  const wallMs = Number(process.hrtime.bigint() - t0) / 1e6;
  // 0.25: a worker reports only what is its own (heap + event-loop busy time). process.cpuUsage()/rss are PROCESS-WIDE and are measured once by the main thread.
  return { tables: o.tables, wallMs, self: RM.sampleWorkerSelf(o.workerId === undefined ? 'main' : o.workerId), reports };
}
module.exports = { runTables };
if (!isMainThread && workerData && workerData.job) runTables(workerData.job).then((r) => parentPort.postMessage({ ok: true, result: r }), (e) => parentPort.postMessage({ ok: false, error: String(e && e.stack || e) }));
