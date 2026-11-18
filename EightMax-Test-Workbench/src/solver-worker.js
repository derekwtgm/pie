'use strict';
// Worker-thread entry for solver-pool.js: builds a decision source from the factory module and answers {id, req} messages.
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  let source;
  try { source = await require(workerData.factory).createSource(workerData.options); } catch (e) { parentPort.postMessage({ type: 'initError', error: String(e && e.message || e) }); return; }
  parentPort.on('message', async (m) => {
    try { parentPort.postMessage({ id: m.id, decision: await source.decide(m.req) }); }
    catch (e) { parentPort.postMessage({ id: m.id, error: String(e && e.message || e) }); }
  });
  parentPort.postMessage({ type: 'ready' });
})();
