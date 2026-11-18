/* EightMax Test Workbench 0.24: solver decisions on real OS threads (Node worker_threads).
 *
 * The 0.23 scheduler ran everything cooperatively on one thread: a solver call that never yielded (a runaway
 * synchronous computation) froze every table and could not even be timed out. Here each decision runs in a worker
 * thread, so (a) several decisions run in parallel on several cores, (b) a stalled or crashed worker is terminated and
 * replaced without touching other workers, and (c) a decision that became stale (the table moved on) can really be killed,
 * not just ignored. Used from Node (tools, tests, benchmark); the browser dashboard keeps its Web Worker + native-CLI route.
 */
'use strict';
const { Worker } = require('node:worker_threads'), path = require('node:path');

class WorkerThreadSource {
  /** options: factory (absolute module path exporting createSource(options)), factoryOptions, size, maxQueue, jobTimeoutMs, killStale (default true) */
  constructor(o) {
    if (!o || !o.factory) throw new Error('A worker factory module is required');
    this.o = { size: 2, maxQueue: 64, jobTimeoutMs: 30000, killStale: true, ...o };
    this.workers = []; this.queue = []; this.closed = false; this.nextId = 0;
    this.stats = { submitted: 0, completed: 0, failed: 0, timeouts: 0, crashes: 0, respawns: 0, killedStale: 0, rejectedFull: 0, busyMs: 0 };
    for (let i = 0; i < this.o.size; i++) this.workers.push(this._spawn(i));
  }
  _spawn(slot) {
    const w = { slot, worker: new Worker(path.join(__dirname, 'solver-worker.js'), { workerData: { factory: this.o.factory, options: this.o.factoryOptions || {} } }), job: null, ready: false, dead: false, started: 0 };
    w.readyPromise = new Promise((res) => { w.markReady = res; });
    w.worker.on('message', (m) => {
      if (m.type === 'ready') { w.ready = true; w.markReady(); this._pump(); return; }
      if (m.type === 'initError') { w.initError = m.error; w.markReady(); return; }
      const j = w.job; if (!j || j.id !== m.id) return;
      w.job = null; clearTimeout(j.timer); this.stats.busyMs += Date.now() - w.started;
      if (m.error) { this.stats.failed++; j.resolve({ status: 'error', reason: m.error }); } else { this.stats.completed++; j.resolve(m.decision); }
      this._pump();
    });
    const die = (why) => {
      if (w.dead) return; w.dead = true; const j = w.job; w.job = null; if (j) { clearTimeout(j.timer); j.resolve({ status: 'error', reason: why }); }
      if (!this.closed) { this.stats.respawns++; this.workers[slot] = this._spawn(slot); this._pump(); }
    };
    w.worker.on('error', (e) => { this.stats.crashes++; die('Worker crashed: ' + e.message); });
    w.worker.on('exit', (code) => { if (!w.dead) { this.stats.crashes++; die('Worker exited with code ' + code); } });
    w.kill = (why) => { const j = w.job; if (j) clearTimeout(j.timer); w.dead = true; w.job = null; if (j) j.resolve({ status: 'cancelled', reason: why }); w.worker.terminate(); if (!this.closed) { this.stats.respawns++; this.workers[slot] = this._spawn(slot); this._pump(); } };
    return w;
  }
  /** Shape expected by SolverService: decide(req, ctx) -> decision | {status:'error'}. */
  decide(req, ctx) {
    if (this.closed) return Promise.resolve({ status: 'error', reason: 'Pool closed' });
    if (this.queue.length >= this.o.maxQueue) { this.stats.rejectedFull++; return Promise.resolve({ status: 'error', reason: 'Worker queue full' }); }
    this.stats.submitted++;
    return new Promise((resolve) => {
      const job = { id: ++this.nextId, req, resolve, ctx, timer: null, poll: null };
      if (ctx && typeof ctx.cancelled === 'function') job.poll = setInterval(() => { if (ctx.cancelled()) { clearInterval(job.poll); const i = this.queue.indexOf(job); if (i >= 0) { this.queue.splice(i, 1); resolve({ status: 'cancelled', reason: 'Cancelled before start' }); return; } const w = this.workers.find((x) => x.job === job); if (w && this.o.killStale) { this.stats.killedStale++; w.kill('Cancelled: the table moved on'); } } }, 20);
      if (job.poll && job.poll.unref) job.poll.unref();
      const done = resolve; job.resolve = (v) => { if (job.poll) clearInterval(job.poll); done(v); };
      this.queue.push(job); this._pump();
    });
  }
  _pump() {
    for (const w of this.workers) {
      if (!this.queue.length) return;
      if (w.dead || !w.ready || w.job) continue;
      const j = this.queue.shift(); w.job = j; w.started = Date.now();
      j.timer = setTimeout(() => { this.stats.timeouts++; if (w.job === j) { w.job = null; j.resolve({ status: 'error', reason: 'Worker exceeded ' + this.o.jobTimeoutMs + ' ms and was terminated' }); w.dead = true; w.worker.terminate(); this.stats.respawns++; this.workers[w.slot] = this._spawn(w.slot); this._pump(); } }, this.o.jobTimeoutMs);
      w.worker.postMessage({ id: j.id, req: j.req });
    }
  }
  async ready() { await Promise.all(this.workers.map((w) => w.readyPromise)); const bad = this.workers.find((w) => w.initError); if (bad) throw new Error('Worker failed to initialise: ' + bad.initError); }
  info() { return { size: this.workers.length, busy: this.workers.filter((w) => w.job).length, queued: this.queue.length, ...this.stats }; }
  async close() { this.closed = true; for (const j of this.queue.splice(0)) j.resolve({ status: 'cancelled', reason: 'Pool closed' }); await Promise.all(this.workers.map((w) => w.worker.terminate())); }
}
module.exports = { WorkerThreadSource };
