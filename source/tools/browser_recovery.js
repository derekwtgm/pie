'use strict';
// Real-browser checkpoint recovery for the offline application (IndexedDB).
// Usage: node tools/browser_recovery.js <dir containing EightMax-Offline.html> [report.json]
// Uses the Playwright Chromium in a persistent profile: the browser process is
// closed and restarted between steps, and the training worker is killed right
// after an automatic checkpoint is written.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const { chromium } = require('playwright');
const dir = path.resolve(process.argv[2] || '.'), reportFile = process.argv[3];
const html = fs.readFileSync(path.join(dir, 'EightMax-Offline.html'));
const server = http.createServer((req, res) => { if (req.url.split('?')[0] === '/EightMax-Offline.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); } else { res.writeHead(404); res.end(); } });
const config = { board: '2c4d7h9sJc', common: 10, stacks: [15, 25, 32], ranges: ['QhQd:0.8,9c9d', 'AsAd,KsTh', 'JhJd,8s8d'], bets: '50,100', raises: 'a', maxBets: 2, privateMode: 'sampled', batchDeals: 4, evaluationDeals: 128, privateSeed: 5 };
const setup = () => {
  const url = URL.createObjectURL(new Blob([document.querySelector('#em-lib').textContent + '\n;EM.workerMain(self);'], { type: 'text/javascript' }));
  window.testWorker = new Worker(url); URL.revokeObjectURL(url);
  window.sendJob = (type, args = {}, interrupt = false) => new Promise((resolve, reject) => {
    testWorker.onerror = (e) => reject(Error(e.message));
    testWorker.onmessage = ({ data: m }) => {
      if (m.type === 'error') reject(Error(m.message)); else if (m.type === 'result') resolve(m.result);
      else if (interrupt && m.saveStatus?.startsWith('Checkpoint saved')) { testWorker.terminate(); resolve({ killedAfter: m.saveStatus, it: m.it }); }
    };
    testWorker.postMessage({ id: 1, type, ...args });
  });
};
const idb = (op) => `new Promise((resolve,reject)=>{const r=indexedDB.open('EightMax-training',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;${op}};})`;
const checks = [], pass = (m) => { checks.push(m); console.log('PASS  ' + m); };
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/EightMax-Offline.html`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'em-browser-'));
  let ctx, failure = null, info = {};
  const open = async () => { ctx = await chromium.launchPersistentContext(profile, { executablePath:process.env.CHROMIUM_PATH||undefined,headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }); const p = await ctx.newPage(); await p.goto(url); await p.evaluate(setup); return p; };
  try {
    let p = await open();
    const killed = await p.evaluate((cfg) => sendJob('multi-solve', { cfg, maxIter: 1000000, target: 0, autosaveSeconds: 1 }, true), config);
    if (!killed.killedAfter) throw Error('no automatic checkpoint before the worker was killed');
    pass('Automatic checkpoint written, then the training worker was terminated mid-run (' + killed.killedAfter + ')');
    info.browser = ctx.browser()?.version?.() || 'chromium (persistent context)';
    await ctx.close();
    p = await open();
    const first = await p.evaluate(() => sendJob('multi-recover')), it = first.metrics.iterations;
    if (!(it > 0 && it < 1000000)) throw Error('bad recovered iteration count ' + it);
    if (first.metrics.trainingDeals !== it * 4) throw Error('sampled-deal count not preserved');
    pass(`After a browser restart the newest checkpoint recovers ${it} updates and ${first.metrics.trainingDeals} sampled deals (${first.reason})`);
    const last = await p.evaluate(() => sendJob('multi-resume', { iterations: 10, target: 0, autosaveSeconds: 1 }));
    if (last.metrics.iterations !== it + 10 || !last.saveStatus.startsWith('Checkpoint saved')) throw Error('resume failed');
    const same = await p.evaluate(async (cfg) => {
      const saved = await sendJob('multi-export'), g = EM.MultiwayGame(cfg);
      g.iterate(JSON.parse(saved.text).payload.state.iterations);
      return JSON.stringify(g.snapshot().state) === JSON.stringify(JSON.parse(saved.text).payload.state);
    }, config);
    if (!same) throw Error('resumed state differs from uninterrupted training');
    pass('Recovered training continues bit-identically to uninterrupted training (regrets, averages, both random streams, counters)');
    await p.evaluate(idb("const tx=db.transaction('checkpoints','readwrite');tx.objectStore('checkpoints').put('bad','latest');tx.onabort=()=>{db.close();resolve(true)};tx.abort();"));
    if ((await p.evaluate(() => sendJob('multi-recover'))).metrics.iterations !== it + 10) throw Error('aborted write changed the stored checkpoint');
    pass('An aborted (incomplete) write leaves the newest valid checkpoint intact');
    await p.evaluate(idb("const tx=db.transaction('checkpoints','readwrite');tx.objectStore('checkpoints').get('latest').onsuccess=e=>{const t=e.target.result;tx.objectStore('checkpoints').put(t.slice(0,t.length-200),'latest');};tx.oncomplete=()=>{db.close();resolve(true)};"));
    const prev = await p.evaluate(() => sendJob('multi-recover'));
    if (prev.metrics.iterations !== it || !/previous/.test(prev.reason)) throw Error('truncated newest checkpoint did not fall back: ' + prev.reason);
    pass('A truncated newest checkpoint fails its integrity check; the previous generation is recovered with a message: "' + prev.reason + '"');
    const version = await p.evaluate(async () => {
      const saved = await sendJob('multi-export'), file = JSON.parse(saved.text); file.payload.engine = 'multiway-9.9';
      const text = JSON.stringify({ sha256: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(file.payload)))), (x) => x.toString(16).padStart(2, '0')).join(''), payload: file.payload });
      try { await sendJob('multi-load', { text }); return 'loaded'; } catch (e) { return e.message; }
    });
    if (!/incompatible EightMax engine \(multiway-9\.9/.test(version)) throw Error('version mismatch not detected: ' + version);
    pass('A checkpoint from an unknown engine version is refused with: "' + version.slice(0, 90) + '…"');
    const quota = await p.evaluate(async () => {
      const put = IDBObjectStore.prototype.put;
      // Chromium reports a full disk by aborting the transaction with QuotaExceededError.
      IDBObjectStore.prototype.put = function (...a) { const tx = this.transaction, r = put.apply(this, a);
        Object.defineProperty(tx, 'error', { get: () => new DOMException('Simulated quota exceeded', 'QuotaExceededError') }); tx.abort(); return r; };
      try { await EM.autosaveTraining('x'); return 'saved'; } catch (e) { return e.message; } finally { IDBObjectStore.prototype.put = put; }
    });
    if (!/storage is full or blocked/.test(quota)) throw Error('quota failure message: ' + quota);
    if ((await p.evaluate(() => sendJob('multi-recover'))).metrics.iterations !== it) throw Error('failed write changed storage');
    pass('A storage-quota failure reports "' + quota.slice(0, 70) + '…" and leaves stored checkpoints unchanged');
    await ctx.close(); ctx = null;
  } catch (e) { failure = e.stack || String(e); console.log('FAIL  ' + failure); }
  finally {
    if (ctx) await ctx.close().catch(() => {});
    server.close(); fs.rmSync(profile, { recursive: true, force: true });
    const report = { passed: !failure, checks, error: failure, browser: 'Playwright Chromium (headless, persistent profile)', node: process.version, generated: new Date().toISOString() };
    if (reportFile) fs.writeFileSync(reportFile, JSON.stringify(report, null, 1) + '\n');
    process.exitCode = failure ? 1 : 0;
  }
})();
