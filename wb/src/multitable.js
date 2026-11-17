/* EightMax Test Workbench 0.23: multi-table scheduler.
 *
 * Up to ten independent tables, each with its own simulator state machine, state-reconstruction
 * engine and action log, share one resource-bounded SolverService and one guarded executor.
 * Workers are cooperative async loops on one JavaScript thread: a failure in one is contained,
 * but this is NOT OS-level parallelism and the CPU is not scaled across cores by this module.
 * Nothing here measures a GPU.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./hand-state.js'), require('./solver-service.js'), require('./test-executor.js'));
  else root.WorkbenchMultiTable = factory(root.EightMax, root.WorkbenchHandState, root.WorkbenchSolverService, root.WorkbenchExecutor);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (EM, HS, SS, EX) {
  'use strict';

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const yieldTurn = typeof setImmediate === 'function' ? () => new Promise((r) => setImmediate(r)) : () => new Promise((r) => setTimeout(r, 0));
  const hasProcess = typeof process !== 'undefined' && typeof process.cpuUsage === 'function';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function percentile(values, p) {
    if (!values.length) return null;
    const a = values.slice().sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.max(0, Math.ceil(p / 100 * a.length) - 1))];
  }
  function stats(values) {
    if (!values.length) return { n: 0, mean: null, p50: null, p95: null, p99: null, max: null };
    return { n: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length, p50: percentile(values, 50), p95: percentile(values, 95), p99: percentile(values, 99), max: Math.max(...values) };
  }
  /** Race with a timeout that always clears its timer (no leaked timers, no late unhandled rejections). */
  function withTimeout(promise, ms, message) {
    let id;
    const timer = new Promise((_, rej) => { id = setTimeout(() => rej(new Error(message)), ms); });
    return Promise.race([promise, timer]).finally(() => clearTimeout(id));
  }
  function fnv(text) { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }

  const DEFAULT_BUDGETS = Object.freeze({
    maxMemoryBytes: 1.5 * 1024 ** 3, maxActiveTables: 10, solverWorkers: 2, maxQueueDepth: 32, maxPendingPerTable: 1,
    cacheBytes: 4 * 1024 * 1024, observationFramesPerSecond: 0 /* 0 = unthrottled */, deadlineMs: 1500,
    maxInvalidFrames: 6, recoveryBackoffMs: 25, maxRecoveries: 3, stallMs: 4000,
  });

  /** Capture / restore a simulator table including RNG and deck so a restart continues identically. */
  function captureTable(t) {
    const o = {};
    for (const k of Object.keys(t)) o[k] = k === 'pending' ? Array.from(t.pending) : k === 'rng' ? { state: t.rng.state } : t[k];
    return JSON.parse(JSON.stringify(o));
  }
  function restoreTable(c, seed = 1) {
    const t = new EM.Table(c.id, seed, c.seats);
    for (const k of Object.keys(c)) { if (k === 'pending') t.pending = new Set(c.pending); else if (k === 'rng') t.rng.state = c.rng.state; else t[k] = JSON.parse(JSON.stringify(c[k])); }
    t.validate();
    return t;
  }

  class TableWorker {
    constructor(sched, id, seed) {
      this.s = sched; this.id = id; this.seed = seed;
      this.table = new EM.Table(id, seed);
      this.engine = new HS.HandStateEngine(id, { autoResumeAfter: 2 });
      this.actions = []; this.seq = 0; this.status = 'idle'; this.reason = null; this.hands = 0;
      this.invalidRun = 0; this.recoveries = 0; this.resumeAt = 0; this.stepNo = 0; this.lastProgress = now();
      this.m = { observation: [], reconstruct: [], solver: [], queueWait: [], e2e: [], deadlineMisses: 0, invalid: 0, droppedObs: 0, stale: 0, solverOk: 0, unavailable: 0, fallback: 0, executed: 0, rejectedActions: 0, errors: 0, crashes: 0, recoveries: 0 };
      this.selectRng = new EM.RNG(seed ^ 0x9e3779b9);
      this.lastObs = null;
    }
    setManualPause(on, reason = 'Paused by operator') { this.manualPause = on; if (on) this.s.executor.pauseTable(this.id, reason); else this.s.executor.resumeTable(this.id); }
    suspend(reason, permanent = false) {
      this.status = permanent ? 'failed' : 'suspended'; this.reason = reason;
      this.s.executor.pauseTable(this.id, reason);
      this.resumeAt = now() + this.s.b.recoveryBackoffMs * 2 ** Math.min(this.recoveries, 6);
      this.s.solver.cancelTable(this.id, 'Table suspended: ' + reason);
    }
    recover() {
      this.recoveries++; this.m.recoveries++;
      if (this.recoveries > this.s.b.maxRecoveries) { this.suspend('Too many recoveries: ' + this.reason, true); return; }
      this.engine.reset(); this.invalidRun = 0; this.lastObs = null;
      try { this.table.validate(); } catch (e) { this.suspend('Simulator state corrupt: ' + e.message, true); return; }
      if (this.table.paused) this.table.resume();
      this.s.executor.resumeTable(this.id); this.status = 'running'; this.reason = null; this.lastProgress = now();
    }
    observe(extra) {
      const t0 = now(), s = this.s;
      let obs = HS.observeSimulator(this.table, this.seq++, { actions: this.actions });
      const f = s.faultFor(this.id, this.stepNo, ['garbage-observation', 'low-confidence', 'drop-observation']);
      if (f) {
        if (f.kind === 'garbage-observation') obs.pot += 37;
        else if (f.kind === 'low-confidence') obs.confidence = { overall: 0.4, fields: obs.confidence.fields };
        else if (f.kind === 'drop-observation') { this.m.droppedObs++; return null; }
      }
      const t1 = now(); this.m.observation.push(t1 - t0);
      const r = this.engine.ingest(obs); this.m.reconstruct.push(now() - t1);
      if (!r.accepted) { this.m.invalid++; this.invalidRun++; }
      else this.invalidRun = 0;
      return r;
    }
    async step() {
      const s = this.s, t = this.table; this.stepNo++;
      const fault = s.faultFor(this.id, this.stepNo, ['throw', 'corrupt-table']);
      if (fault && fault.kind === 'throw') throw new Error('Injected worker failure');
      if (fault && fault.kind === 'corrupt-table') t.players[0].stack += 1;
      if (t.status === 'ready' || t.status === 'complete') {
        if (t.status === 'complete') { this.observe(); this.hands++; s.totals.hands++; }
        if (this.hands >= s.handsPerTable) { this.status = 'done'; return; }
        t.startHand(); this.actions = [];
      }
      const r = this.observe();
      if (!r) return;
      if (!r.accepted || r.paused) {
        if (this.invalidRun >= s.b.maxInvalidFrames) this.suspend('Unreadable state for ' + this.invalidRun + ' frames: ' + this.engine.pauseReason);
        else s.executor.pauseTable(this.id, this.engine.pauseReason || 'observation rejected');
        return;
      }
      if (s.executor.pausedTables.has(this.id) && this.status === 'running') s.executor.resumeTable(this.id);
      const st = r.state;
      if (st.status !== 'playing') return;
      const tDecision = now();
      let req;
      try { req = SS.requestFromState(st, { priority: this.s.priorityFor(this), deadlineMs: s.b.deadlineMs }); } catch (e) { this.m.errors++; this.suspend('Cannot form a decision request: ' + e.message); return; }
      const res = await s.solver.submit(req);
      this.view = { hand: st.hand, street: st.street, pot: st.pot, button: st.button, actor: st.actor, stacks: st.seats.map((p) => p.stack + p.bet), legal: st.legal, confidence: st.confidence, result: res.status, reason: res.reason || null, decisionMs: res.latencyMs === undefined ? null : res.latencyMs, decision: res.status === 'ok' && res.decision ? { recommended: res.decision.recommended, labels: res.decision.labels, probabilities: res.decision.probabilities, trainingUpdates: res.decision.trainingUpdates, convergence: res.decision.convergence, warnings: res.decision.warnings, engine: res.decision.engine, studyId: res.decision.studyId, issuedAt: res.decision.issuedAt } : null };
      if (s.mode === 'study') { this.status = 'done'; return; } // Study Mode: recommendation only, nothing is executed
      if (res.status === 'ok') {
        this.m.solver.push(res.latencyMs); this.m.queueWait.push(res.queuedMs); this.m.solverOk++;
        // The table may have changed while we waited; the executor re-checks against the live engine state.
        const live = this.engine.state;
        if (!live || live.revision !== req.revision) { this.m.stale++; return; }
        const x = await s.executor.execute(res.decision, { select: s.select, stateOverride: undefined });
        this.errRun = 0;
        if (x.status === 'confirmed') {
          this.m.executed++; s.totals.actions++; s.totals.solverActions++;
          this.actions.push({ seat: req.actor, type: x.action.type === 'raise' && x.action.amount >= st.seats[req.actor].bet + st.seats[req.actor].stack ? 'allin' : x.action.type, amount: x.action.amount });
          const e2e = now() - tDecision; this.m.e2e.push(e2e); if (e2e > s.b.deadlineMs) this.m.deadlineMisses++;
          this.lastProgress = now();
          this.rejRun = 0;
        } else if (x.status === 'rejected' || x.status === 'duplicate' || x.status === 'blocked') {
          this.m.rejectedActions++;
          if (++this.rejRun >= 5) { this.rejRun = 0; this.suspend('Repeated action ' + x.status + ': ' + x.reason); return; }
          await sleep(2);
        }
        else if (x.status === 'unconfirmed') this.suspend('Unconfirmed action');
      } else if (res.status === 'stale' || res.status === 'cancelled') this.m.stale++;
      else if (res.status === 'unavailable') {
        this.m.unavailable++;
        if (s.allowFallback) await this.fallback(st, req, tDecision);
        else this.suspend('Solver unavailable: ' + res.reason);
      } else if (res.status === 'timeout') { this.m.errors++; this.m.deadlineMisses++; if (++this.timeouts >= 3) this.suspend('Solver timeouts'); }
      else {
        this.m.errors++; this.errRun = (this.errRun || 0) + 1;
        if (this.errRun >= 5) { this.errRun = 0; this.suspend('Repeated solver ' + res.status + ': ' + res.reason); return; }
        await sleep(2);
      }
    }
    get timeouts() { return this._to || 0; } set timeouts(v) { this._to = v; }
    /** Scripted test policy; counted separately and NEVER reported as a solver decision. */
    async fallback(st, req, t0) {
      const a = EM.policy(this.table), r = this.table.request(a.type, a.amount, 0);
      try { this.table.execute(r, 0); } catch (e) { this.m.errors++; return; }
      this.m.fallback++; this.s.totals.actions++; this.s.totals.fallbackActions++;
      this.actions.push({ seat: req.actor, type: a.type, amount: a.amount });
    }
    async loop() {
      const s = this.s;
      this.status = 'running';
      while (!s.stopping && this.status !== 'done' && this.status !== 'failed') {
        await yieldTurn();
        if (s.estopped) break;
        if (this.staticHold) { this.status = 'capacity-limited'; this.reason = 'Beyond maxActiveTables budget (' + s.b.maxActiveTables + ')'; return; }
        if (this.heldByCapacity) { this.status = 'held-memory'; await sleep(2); if (!this.heldByCapacity) this.status = 'running'; continue; }
        if (this.manualPause) { this.status = 'paused'; await sleep(10); continue; }
        if (this.status === 'paused') this.status = 'running';
        if (this.status === 'suspended') { if (now() < this.resumeAt) { await sleep(2); continue; } this.recover(); continue; }
        try { await withTimeout(this.step(), s.b.stallMs, 'Table step exceeded ' + s.b.stallMs + ' ms'); }
        catch (e) { this.m.crashes++; this.m.errors++; this.suspend('Worker crash: ' + e.message); }
      }
      if (s.estopped && this.status === 'running') this.status = 'stopped';
    }
    summary() {
      const m = this.m;
      return { table: this.id, status: this.status, reason: this.reason, hands: this.hands, actions: m.executed + m.fallback, solverActions: m.executed, fallbackActions: m.fallback,
        invalidObservations: m.invalid, droppedObservations: m.droppedObs, staleDecisions: m.stale, unavailable: m.unavailable, deadlineMisses: m.deadlineMisses, crashes: m.crashes, recoveries: m.recoveries,
        latency: { observation: stats(m.observation), reconstruction: stats(m.reconstruct), solver: stats(m.solver), queueWait: stats(m.queueWait), endToEnd: stats(m.e2e) } };
    }
  }

  class MultiTableScheduler {
    /**
     * options: tables (1-10), seed, handsPerTable, decisionSource (object with decide(req)), budgets, faults, select, allowFallback,
     *          rss() -> bytes (memory probe)
     */
    constructor(options) {
      const o = options || {};
      if (!Number.isInteger(o.tables) || o.tables < 1 || o.tables > 10) throw new Error('Use 1 to 10 tables');
      if (!o.decisionSource || typeof o.decisionSource.decide !== 'function') throw new Error('A decision source is required');
      this.b = { ...DEFAULT_BUDGETS, ...(o.budgets || {}) };
      this.handsPerTable = o.handsPerTable || 10; this.select = o.select || 'recommended'; this.allowFallback = !!o.allowFallback;
      this.faults = (o.faults || []).map((f) => ({ ...f, fired: false })); this.source = o.decisionSource;
      this.rss = o.rss || (hasProcess ? () => process.memoryUsage().rss : () => (typeof performance !== 'undefined' && performance.memory ? performance.memory.usedJSHeapSize : 0));
      this.mode = o.mode === 'study' ? 'study' : 'simulation';
      this.stalled = new Set(); this.stopping = false; this.estopped = false;
      this.totals = { hands: 0, actions: 0, solverActions: 0, fallbackActions: 0 };
      this.concurrent = 0; this.maxConcurrent = 0; this.peakRss = 0; this.pressureEvents = 0;
      this.solver = new SS.SolverService({
        decide: (req, ctx) => this._decide(req, ctx), workers: this.b.solverWorkers, maxQueue: this.b.maxQueueDepth, maxPending: this.b.maxPendingPerTable,
        cacheBytes: this.b.cacheBytes, memoryPressure: () => this.pressure(), currentRevision: (t) => { const w = this.workers[t - 1]; return w && w.engine.state ? w.engine.revision : undefined; },
      });
      this.executor = new EX.TestExecutor({ stateOf: (t) => { const w = this.workers[t - 1]; return w ? { state: w.engine.state, paused: w.engine.paused, pauseReason: w.engine.pauseReason, revision: w.engine.revision } : null; }, now: () => Date.now(), maxActionAgeMs: Math.max(this.b.deadlineMs, 1500) });
      this.executor.setMode(this.mode);
      const seed = o.seed === undefined ? 4127 : o.seed;
      this.workers = Array.from({ length: o.tables }, (_, i) => new TableWorker(this, i + 1, seed + i * 139));
      this.workers.forEach((w, i) => { this.executor.attach(w.id, new EX.SimulatorAdapter(w.table, () => 0)); w.staticHold = i >= this.b.maxActiveTables; });
      this.samples = [];
    }
    pressure() { const r = this.rss(); this.peakRss = Math.max(this.peakRss, r); return r / this.b.maxMemoryBytes; }
    priorityFor(w) { return w.m.errors > 2 ? 3 : w.hands < 1 ? 1 : 2; }
    faultFor(table, step, kinds) {
      const f = this.faults.find((x) => !x.fired && x.table === table && x.step <= step && kinds.includes(x.kind));
      if (f) { if (!f.repeat) f.fired = true; return f; }
      return null;
    }
    async _decide(req, ctx) {
      this.concurrent++; this.maxConcurrent = Math.max(this.maxConcurrent, this.concurrent);
      try {
        if (this.faults.some((f) => f.kind === 'stall-solver' && f.table === req.table && f.step <= this.workers[req.table - 1].stepNo)) { await new Promise((r) => { const iv = setInterval(() => { if (ctx.cancelled()) { clearInterval(iv); r(); } }, 5); iv.unref && iv.unref(); }); return { status: 'error', reason: 'stalled' }; }
        return this.source.decide(req);
      } finally { this.concurrent--; }
    }
    /** Memory-pressure governor: hold the highest-numbered active tables while pressure is high, release below 75%. */
    govern() {
      const p = this.pressure();
      const active = this.workers.filter((w) => !w.staticHold && !w.heldByCapacity && w.status !== 'done' && w.status !== 'failed');
      const held = this.workers.filter((w) => w.heldByCapacity && w.capacityHold === 'memory');
      if (!active.length && held.length) { const w = held[0]; w.heldByCapacity = false; w.capacityHold = null; w.table.resume(); this.executor.resumeTable(w.id); } // run sequentially rather than deadlock
      else if (p > 0.9 && active.length > 1) { const w = active[active.length - 1]; w.heldByCapacity = true; w.capacityHold = 'memory'; this.pressureEvents++; w.table.pause(); this.executor.pauseTable(w.id, 'Memory pressure'); }
      else if (p < 0.75) for (const w of this.workers) if (w.capacityHold === 'memory' && w.heldByCapacity) { w.heldByCapacity = false; w.capacityHold = null; w.table.resume(); this.executor.resumeTable(w.id); break; }
      this.samples.push({ t: now(), rss: this.rss(), pressure: p, solver: this.solver.info() });
    }
    pauseTable(id, reason) { const w = this.workers[id - 1]; if (w) w.setManualPause(true, reason); }
    resumeTable(id) { const w = this.workers[id - 1]; if (!w) return false; if (w.status === 'failed' || w.status === 'suspended') return false; w.setManualPause(false); return true; }
    emergencyStop(reason = 'Emergency stop') {
      this.estopped = true; this.executor.emergencyStop(reason); this.solver.stop();
      for (const w of this.workers) { w.table.pause(); }
    }
    async run() {
      const t0 = now(), cpu0 = hasProcess ? process.cpuUsage() : null;
      const iv = setInterval(() => this.govern(), 20); iv.unref && iv.unref();
      try { await Promise.all(this.workers.map((w) => w.loop())); } finally { clearInterval(iv); }
      const wall = now() - t0, cpu = hasProcess ? process.cpuUsage(cpu0) : null;
      this.solver.stop();
      return this.result(wall, cpu);
    }
    result(wallMs, cpu) {
      const ws = this.workers.map((w) => w.summary());
      const all = (k) => this.workers.flatMap((w) => w.m[k]);
      const rssNow = this.rss();
      return {
        format: 'eightmax-multitable-run', version: 1, tables: this.workers.length, wallMs, handsCompleted: this.totals.hands, actions: this.totals.actions,
        solverActions: this.totals.solverActions, fallbackActions: this.totals.fallbackActions,
        handsPerSecond: wallMs > 0 ? this.totals.hands / (wallMs / 1000) : null,
        latency: { observation: stats(all('observation')), reconstruction: stats(all('reconstruct')), solver: stats(all('solver')), queueWait: stats(all('queueWait')), endToEnd: stats(all('e2e')) },
        deadlineMs: this.b.deadlineMs, deadlineMisses: ws.reduce((n, w) => n + w.deadlineMisses, 0),
        invalidObservations: ws.reduce((n, w) => n + w.invalidObservations, 0), droppedObservations: ws.reduce((n, w) => n + w.droppedObservations, 0),
        crashes: ws.reduce((n, w) => n + w.crashes, 0), recoveries: ws.reduce((n, w) => n + w.recoveries, 0),
        cpu: cpu ? { userMs: cpu.user / 1000, systemMs: cpu.system / 1000, utilizationOfOneCore: wallMs > 0 ? (cpu.user + cpu.system) / 1000 / wallMs : null } : null,
        memory: { rssBytes: rssNow, peakRssBytes: this.peakRss, budgetBytes: this.b.maxMemoryBytes, pressureEvents: this.pressureEvents },
        gpu: { measured: false, note: 'No GPU code path is used or measured by this module' },
        solver: { ...this.solver.info(), maxConcurrentDecisions: this.maxConcurrent, workers: this.b.solverWorkers },
        perTable: ws,
      };
    }
    /** Serialise every table so a restart can continue; hash allows corruption detection. */
    checkpoint() {
      const body = { format: 'eightmax-multitable-checkpoint', version: 1, tables: this.workers.map((w) => ({ id: w.id, seed: w.seed, hands: w.hands, seq: w.seq, actions: w.actions, table: captureTable(w.table) })) };
      return { ...body, hash: fnv(JSON.stringify(body)) };
    }
  }

  /** Validate and restore a checkpoint into scheduler workers (before run()). */
  function restoreCheckpoint(sched, cp) {
    if (!cp || cp.format !== 'eightmax-multitable-checkpoint' || cp.version !== 1) throw new Error('Unsupported checkpoint');
    const { hash, ...body } = cp;
    if (fnv(JSON.stringify(body)) !== hash) throw new Error('Checkpoint hash mismatch: file is corrupt or edited');
    if (cp.tables.length !== sched.workers.length) throw new Error('Checkpoint table count differs');
    cp.tables.forEach((c, i) => {
      const w = sched.workers[i]; if (w.id !== c.id) throw new Error('Checkpoint table order differs');
      w.table = restoreTable(c.table, c.seed); w.table.paused = false; w.hands = c.hands; w.seq = c.seq; w.actions = JSON.parse(JSON.stringify(c.actions));
      w.engine.reset(); sched.executor.attach(w.id, new EX.SimulatorAdapter(w.table, () => 0));
    });
    return sched;
  }

  return { withTimeout, DEFAULT_BUDGETS, percentile, stats, captureTable, restoreTable, TableWorker, MultiTableScheduler, restoreCheckpoint };
});
