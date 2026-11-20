/* EightMax Test Workbench 0.35.0: CENTRALISED INPUT SCHEDULER - one physical cursor, many tables.
 *
 * Windows has one shared cursor and one keyboard focus, so physical input from all table workers is serialised here:
 *   * a bounded queue ordered by deadline (earliest first), ties by submission order;
 *   * exactly one lease at a time ("cursor ownership"); a table worker never talks to the driver outside its lease;
 *   * before a job starts: drop it if its deadline cannot be met at the CONFIGURED speed (estimate from the motion model;
 *     movements are never sped up to make a deadline), and re-validate it (fresh observation, same hand, still legal);
 *   * pause per table, pause all, emergency stop (rejects everything queued and cancels the running job).
 * Metrics: queue wait, run time, deadline misses, rejections by reason, peak queue length.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WorkbenchInputScheduler = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const mono = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const stats = (a) => { if (!a.length) return { n: 0 }; const s = a.slice().sort((x, y) => x - y), q = (p) => s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)]; return { n: s.length, mean: +(s.reduce((x, y) => x + y, 0) / s.length).toFixed(2), p50: +q(50).toFixed(2), p95: +q(95).toFixed(2), p99: +q(99).toFixed(2), max: +s[s.length - 1].toFixed(2) }; };

  class InputScheduler {
    /** o: now(), maxQueue, onCancel(job) -> cancels the running driver operation, onEvent(kind, data) */
    constructor(o = {}) {
      this.now = o.now || mono; this.maxQueue = o.maxQueue || 16; this.onCancel = o.onCancel || (() => {}); this.onEvent = o.onEvent || (() => {});
      this.queue = []; this.running = null; this.seq = 0; this.paused = new Map(); this.allPaused = null; this.estop = null;
      this.m = { submitted: 0, started: 0, completed: 0, failed: 0, rejected: {}, wait: [], run: [], peakQueue: 0, deadlineMisses: 0, slackAtStart: [] };
    }
    _reject(job, code, reason) { this.m.rejected[code] = (this.m.rejected[code] || 0) + 1; this.onEvent('rejected', { table: job.table, code, reason }); job.resolve({ ok: false, code, reason, table: job.table, waitedMs: this.now() - job.at }); }
    /**
     * job: { table, kind, deadline (absolute ms on this.now() clock), estimateMs, revalidate() -> {ok, reason}, run(lease) -> result }
     * Resolves with {ok:true, result, waitedMs, runMs} or {ok:false, code, reason}.
     */
    submit(job) {
      return new Promise((resolve) => {
        const j = { ...job, id: ++this.seq, at: this.now(), resolve }; this.m.submitted++;
        if (this.estop) return this._reject(j, 'emergency-stop', 'Emergency stop: ' + this.estop);
        if (this.allPaused) return this._reject(j, 'paused', 'All tables paused: ' + this.allPaused);
        if (this.paused.has(j.table)) return this._reject(j, 'paused', 'Table paused: ' + this.paused.get(j.table));
        if (this.queue.some((q) => q.table === j.table) || (this.running && this.running.table === j.table)) return this._reject(j, 'table-busy', 'This table already has an input job queued or running');
        if (this.queue.length >= this.maxQueue) return this._reject(j, 'queue-full', 'Input queue is full (' + this.maxQueue + ')');
        if (!Number.isFinite(j.deadline)) return this._reject(j, 'no-deadline', 'Every input job needs a deadline');
        this.queue.push(j); this.queue.sort((a, b) => a.deadline - b.deadline || a.id - b.id); this.m.peakQueue = Math.max(this.m.peakQueue, this.queue.length);
        this._pump();
      });
    }
    async _pump() {
      // One pump at a time: the lease is reserved BEFORE the (async) revalidation, so no second job can start meanwhile
      // (0.35 test found overlapping input when two submissions raced through an awaiting revalidation).
      if (this.running || this.pumping) return; this.pumping = true;
      try { await this._drain(); } finally { this.pumping = false; }
      if (this.queue.length && !this.running) this._pump();   // a job submitted while the drain loop was finishing
    }
    async _drain() {
      while (this.queue.length && !this.running) {
        const j = this.queue.shift(), t = this.now(), est = Math.max(0, j.estimateMs || 0);
        if (this.estop) { this._reject(j, 'emergency-stop', 'Emergency stop: ' + this.estop); continue; }
        if (this.allPaused || this.paused.has(j.table)) { this._reject(j, 'paused', 'Table paused before its input started'); continue; }
        if (t + est > j.deadline) { this.m.deadlineMisses++; this._reject(j, 'deadline', 'Cannot finish by the deadline at the configured speed (needs ' + Math.round(est) + ' ms, ' + Math.round(j.deadline - t) + ' ms left); not rushed'); continue; }
        this.running = j;   // lease reserved: revalidation already owns the cursor
        let v = { ok: true }; if (typeof j.revalidate === 'function') { try { v = await j.revalidate(); } catch (e) { v = { ok: false, reason: e.message }; } }
        if (!v || v.ok !== true) { this.running = null; this._reject(j, 'stale', 'Revalidation failed: ' + (v && v.reason || 'unknown')); continue; }
        if (this.estop) { this.running = null; this._reject(j, 'emergency-stop', 'Emergency stop: ' + this.estop); continue; }
        this.m.started++; this.m.wait.push(t - j.at); this.m.slackAtStart.push(j.deadline - t - est); if (this.m.wait.length > 5000) { this.m.wait.shift(); this.m.slackAtStart.shift(); }
        const lease = { table: j.table, id: j.id, deadline: j.deadline, get valid() { return this._valid !== false; }, remainingMs: () => j.deadline - this.now() };
        this.onEvent('lease', { table: j.table, id: j.id, waitedMs: t - j.at });
        const t1 = this.now(); let out;
        try { const r = await j.run(lease); out = { ok: true, result: r, waitedMs: t1 - j.at, runMs: this.now() - t1 }; this.m.completed++; }
        catch (e) { out = { ok: false, code: e.code || 'run-failed', reason: e.message, waitedMs: t1 - j.at, runMs: this.now() - t1 }; this.m.failed++; }
        lease._valid = false; this.m.run.push(this.now() - t1); if (this.m.run.length > 5000) this.m.run.shift();
        this.running = null; this.onEvent('release', { table: j.table, id: j.id }); j.resolve(out);
      }
    }
    pauseTable(table, reason = 'paused') { this.paused.set(table, reason); for (const j of this.queue.filter((q) => q.table === table)) { this.queue.splice(this.queue.indexOf(j), 1); this._reject(j, 'paused', 'Table paused: ' + reason); } }
    resumeTable(table) { this.paused.delete(table); }
    pauseAll(reason = 'paused by operator') { this.allPaused = reason; for (const j of this.queue.splice(0)) this._reject(j, 'paused', 'All tables paused: ' + reason); }
    resumeAll() { this.allPaused = null; }
    /** Cancel the running job (driver cancel) and reject everything queued; nothing starts until reset(). */
    emergencyStop(reason = 'Emergency stop') { this.estop = reason; for (const j of this.queue.splice(0)) this._reject(j, 'emergency-stop', 'Emergency stop: ' + reason); if (this.running) { try { this.onCancel(this.running); } catch (e) { /* driver gone */ } } this.onEvent('estop', { reason }); }
    cancelCurrent(reason = 'cancelled by operator') { if (this.running) { try { this.onCancel(this.running, reason); } catch (e) { /* driver gone */ } return true; } return false; }
    reset() { this.estop = null; }
    status() { return { running: this.running ? { table: this.running.table, kind: this.running.kind, id: this.running.id } : null, queued: this.queue.map((j) => ({ table: j.table, kind: j.kind, msToDeadline: Math.round(j.deadline - this.now()) })), estop: this.estop, allPaused: this.allPaused, pausedTables: [...this.paused.keys()] }; }
    metrics() { return { submitted: this.m.submitted, started: this.m.started, completed: this.m.completed, failed: this.m.failed, rejected: { ...this.m.rejected }, deadlineMisses: this.m.deadlineMisses, peakQueue: this.m.peakQueue, queueWaitMs: stats(this.m.wait), runMs: stats(this.m.run), slackAtStartMs: stats(this.m.slackAtStart) }; }
  }
  return { InputScheduler, stats };
});
