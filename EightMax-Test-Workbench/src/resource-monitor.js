/* EightMax Test Workbench 0.25: correct CPU / memory accounting.
 *
 * Why this module exists (defect found in 0.24): benchmark workers called process.cpuUsage() and
 * process.memoryUsage().rss from INSIDE worker threads. Both are PROCESS-WIDE numbers, so every worker
 * reported the whole process, and the benchmark then SUMMED them (e.g. 2 workers -> "4.0 cores busy",
 * "peakRssBytesSum" = 4x the real resident set). 0.25 rules:
 *
 *   * process CPU and process RSS are measured ONCE, by the owning (main) thread/process, never summed over workers;
 *   * a worker may report only what is genuinely its own: V8 heap of its isolate and event-loop busy time
 *     (an ESTIMATE of its CPU use: it excludes native threads and GC helper threads);
 *   * native-solver memory is a separate figure (child-process RSS), never added to process RSS;
 *   * every figure carries unit + measurement source; unmeasured figures are null, never 0 and never guessed;
 *   * validate() rejects impossible, stale, negative, duplicated or incomplete samples.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WorkbenchResourceMonitor = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const hasProcess = typeof process !== 'undefined' && typeof process.cpuUsage === 'function';
  const mono = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const num = (x) => typeof x === 'number' && Number.isFinite(x);
  const UNITS = Object.freeze({ cpu: 'ms of CPU time', cores: 'logical-core equivalents (cpuMs / wallMs)', memory: 'bytes', time: 'ms', interval: 'ms' });

  /** Sources, spelled out so a report can never be mistaken for something it is not. */
  const SOURCES = Object.freeze({
    processCpu: 'process.cpuUsage() sampled by the owning thread (process-wide user+system)',
    processRss: 'process.memoryUsage().rss sampled by the owning thread (process-wide resident set)',
    workerHeap: 'v8 heap statistics read inside the worker (that isolate only)',
    workerBusy: 'worker performance.eventLoopUtilization().active (ESTIMATE of worker CPU; excludes native threads)',
    nativeRss: 'resident set of the native solver child process (separate process; not part of process RSS)',
    gpu: 'not measured: no verified GPU execution path exists in this build',
  });

  /* ---------- samples ---------- */
  /** One process-wide sample. Call ONLY from the thread that owns the process view (main thread). */
  function sampleProcess(clock = mono) {
    const t = clock();
    if (!hasProcess) return { t, cpuUserMs: null, cpuSystemMs: null, rssBytes: null, heapUsedBytes: null, externalBytes: null, arrayBuffersBytes: null };
    const c = process.cpuUsage(), m = process.memoryUsage();
    return { t, cpuUserMs: c.user / 1000, cpuSystemMs: c.system / 1000, rssBytes: m.rss, heapUsedBytes: m.heapUsed, externalBytes: m.external, arrayBuffersBytes: m.arrayBuffers };
  }

  /** What a worker thread may truthfully report about itself. Deliberately has NO rss and NO process cpu. */
  function sampleWorkerSelf(id, clock = mono) {
    let heap = null, active = null, util = null;
    try { heap = process.memoryUsage().heapUsed; } catch (e) { /* not available */ }
    try { const perf = require('node:perf_hooks').performance; const e = perf.eventLoopUtilization(); active = e.active; util = e.utilization; } catch (e) { /* not available */ }
    return { scope: 'worker', worker: id, t: clock(), heapUsedBytes: heap, eventLoopActiveMs: active, eventLoopUtilization: util };
  }

  /** Native solver child process resident set (Linux /proc; elsewhere null = not measured). */
  function sampleNativeRss(pid) {
    try { if (process.platform !== 'linux' || !pid) return null; const s = require('node:fs').readFileSync('/proc/' + pid + '/status', 'utf8'), m = /VmRSS:\s+(\d+) kB/.exec(s); return m ? +m[1] * 1024 : null; } catch (e) { return null; }
  }

  /**
   * Continuous process sampler for one run. start() / stop() on the owning thread; samples are bounded.
   * report() returns a figure set whose CPU comes from the first-to-last process delta, RSS from the maximum single sample.
   */
  class RunMonitor {
    constructor(o = {}) {
      this.intervalMs = o.intervalMs || 100; this.maxSamples = o.maxSamples || 2000; this.clock = o.clock || mono; this.logicalCpus = o.logicalCpus || (typeof require === 'function' ? require('node:os').cpus().length : 1);
      this.totalMemBytes = o.totalMemBytes || (typeof require === 'function' ? require('node:os').totalmem() : null); this.sample = o.sample || (() => sampleProcess(this.clock)); this.samples = []; this.workers = new Map(); this.nativePids = []; this.timer = null;
    }
    start() { this.samples = []; this._take(); if (this.intervalMs > 0) { this.timer = setInterval(() => this._take(), this.intervalMs); if (this.timer.unref) this.timer.unref(); } return this; }
    _take() { const s = this.sample(); if (this.samples.length >= this.maxSamples) this.samples.splice(1, 1); this.samples.push(s); return s; }
    /** Register what a worker reported about itself (its own heap and busy time). Later reports replace earlier ones. */
    workerReport(r) { if (!r || r.scope !== 'worker') throw new Error('A worker report must have scope "worker" (process-wide numbers are not accepted from workers)'); if ('rssBytes' in r || 'cpuUserMs' in r || 'cpuMs' in r) throw new Error('Workers must not report process-wide rss/cpu'); const prev = this.workers.get(r.worker); this.workers.set(r.worker, { ...r, heapPeakBytes: Math.max(r.heapUsedBytes || 0, prev && prev.heapPeakBytes || 0) }); }
    watchNative(pid) { if (pid) this.nativePids.push(pid); }
    stop() { if (this.timer) clearInterval(this.timer), this.timer = null; this._take(); return this.report(); }
    report(expect = {}) {
      return buildReport({ samples: this.samples, workers: [...this.workers.values()], logicalCpus: this.logicalCpus, totalMemBytes: this.totalMemBytes, intervalMs: this.intervalMs, expectedWorkers: expect.workers, nativeRssBytes: this.nativePids.length ? this.nativePids.reduce((n, p) => n + (sampleNativeRss(p) || 0), 0) || null : null, clock: this.clock });
    }
  }

  /** Build the corrected report from process samples + per-worker self reports. Pure function: used by tests with synthetic input. */
  function buildReport(o) {
    const s = o.samples || [], first = s[0], last = s[s.length - 1];
    const wall = first && last ? last.t - first.t : null;
    const cpuMs = first && last && num(first.cpuUserMs) && num(last.cpuUserMs) ? (last.cpuUserMs + last.cpuSystemMs) - (first.cpuUserMs + first.cpuSystemMs) : null;
    const rssAll = s.map((x) => x.rssBytes).filter(num);
    const cores = cpuMs !== null && wall > 0 ? cpuMs / wall : null;
    const workers = (o.workers || []).map((w) => ({ worker: w.worker, heapUsedBytes: w.heapUsedBytes, heapPeakBytes: w.heapPeakBytes === undefined ? w.heapUsedBytes : w.heapPeakBytes, busyMsEstimate: w.eventLoopActiveMs, eventLoopUtilization: w.eventLoopUtilization, sampledAt: w.t }));
    const rep = {
      format: 'eightmax-resource-report', version: 1, units: UNITS, sources: SOURCES,
      elapsedMs: wall, sampleCount: s.length, samplingIntervalMs: o.intervalMs === undefined ? null : o.intervalMs, logicalCpus: o.logicalCpus,
      process: {
        cpuMs, cpuCoresBusy: cores, cpuUtilizationOfMachine: cores !== null && o.logicalCpus ? cores / o.logicalCpus : null,
        rssBytesPeak: rssAll.length ? Math.max(...rssAll) : null, rssBytesFinal: rssAll.length ? rssAll[rssAll.length - 1] : null,
        heapUsedBytesPeak: s.map((x) => x.heapUsedBytes).filter(num).reduce((a, b) => Math.max(a, b), 0) || null,
      },
      workers, workerCount: workers.length,
      workerHeapBytesSum: workers.length && workers.every((w) => num(w.heapUsedBytes)) ? workers.reduce((n, w) => n + w.heapUsedBytes, 0) : null,
      workerBusyMsEstimateSum: workers.length && workers.every((w) => num(w.busyMsEstimate)) ? workers.reduce((n, w) => n + w.busyMsEstimate, 0) : null,
      nativeSolverRssBytes: o.nativeRssBytes === undefined ? null : o.nativeRssBytes,
      gpu: { supported: false, measured: false, memoryBytes: null, note: SOURCES.gpu },
      note: 'process.* is measured once for the whole process; worker figures are per-isolate and are NEVER added to process RSS; worker busy time is an estimate.',
    };
    rep.validation = validate(rep, { totalMemBytes: o.totalMemBytes, expectedWorkers: o.expectedWorkers, now: o.clock ? o.clock() : mono(), maxAgeMs: o.maxAgeMs });
    return rep;
  }

  /**
   * Detect impossible or untrustworthy figures. Returns {ok, problems:[{code, detail}]}. Codes:
   * negative-elapsed, invalid-number, cpu-impossible, cpu-double-counted, memory-impossible, memory-double-counted,
   * worker-process-wide-field, missing-worker-measurement, stale-metrics, too-few-samples.
   */
  function validate(rep, o = {}) {
    const p = [], add = (code, detail) => p.push({ code, detail });
    if (!(num(rep.elapsedMs))) add('invalid-number', 'elapsedMs missing'); else if (rep.elapsedMs < 0) add('negative-elapsed', 'elapsedMs=' + rep.elapsedMs);
    if (rep.sampleCount < 2) add('too-few-samples', 'need at least 2 process samples, have ' + rep.sampleCount);
    const pr = rep.process || {};
    for (const [k, v] of Object.entries(pr)) if (v !== null && v !== undefined && !num(v)) add('invalid-number', 'process.' + k + ' is not a finite number');
    if (num(pr.cpuMs) && pr.cpuMs < 0) add('invalid-number', 'process.cpuMs negative');
    if (num(pr.cpuCoresBusy) && rep.logicalCpus && pr.cpuCoresBusy > rep.logicalCpus * 1.10 + 0.05) {
      add('cpu-impossible', 'process CPU ' + pr.cpuCoresBusy.toFixed(2) + ' cores exceeds the ' + rep.logicalCpus + ' logical CPUs available');
    }
    // Consistency with the workers' own busy time: the main thread adds about one core and GC/helper threads a little more.
    // A process figure far above that is the signature of a process-wide number that was summed once per worker.
    if (num(pr.cpuCoresBusy) && rep.workerCount > 1 && num(rep.workerBusyMsEstimateSum) && rep.elapsedMs > 0) {
      const workerCores = rep.workerBusyMsEstimateSum / rep.elapsedMs;
      if (pr.cpuCoresBusy > workerCores * 1.5 + 1.5) add('cpu-double-counted', 'process CPU ' + pr.cpuCoresBusy.toFixed(2) + ' cores is not explained by ' + rep.workerCount + ' workers busy ' + workerCores.toFixed(2) + ' cores: a process-wide figure was probably summed per worker');
    }
    const total = o.totalMemBytes || null;
    if (total && num(pr.rssBytesPeak) && pr.rssBytesPeak > total) add('memory-impossible', 'process RSS ' + pr.rssBytesPeak + ' exceeds physical memory ' + total);
    if (total && num(rep.workerHeapBytesSum) && rep.workerHeapBytesSum > total) add('memory-impossible', 'worker heap sum exceeds physical memory');
    if (num(rep.workerHeapBytesSum) && num(pr.rssBytesPeak) && rep.workerHeapBytesSum > pr.rssBytesPeak * 1.05) add('memory-double-counted', 'worker heaps (' + rep.workerHeapBytesSum + ' B) exceed the whole process resident set (' + pr.rssBytesPeak + ' B): a process-wide figure was probably summed per worker');
    for (const w of rep.workers || []) {
      if ('rssBytes' in w || 'cpuMs' in w || 'cpuUserMs' in w) add('worker-process-wide-field', 'worker ' + w.worker + ' carries a process-wide field');
      for (const k of ['heapUsedBytes', 'busyMsEstimate']) if (w[k] !== null && w[k] !== undefined && (!num(w[k]) || w[k] < 0)) add('invalid-number', 'worker ' + w.worker + ' ' + k + ' invalid');
      if (w.heapUsedBytes === null || w.heapUsedBytes === undefined) add('missing-worker-measurement', 'worker ' + w.worker + ' has no heap measurement');
    }
    if (o.expectedWorkers !== undefined && (rep.workers || []).length !== o.expectedWorkers) add('missing-worker-measurement', 'expected ' + o.expectedWorkers + ' worker reports, have ' + (rep.workers || []).length);
    if (o.maxAgeMs && o.now !== undefined) for (const w of rep.workers || []) if (num(w.sampledAt) && o.now - w.sampledAt > o.maxAgeMs) add('stale-metrics', 'worker ' + w.worker + ' report is ' + Math.round(o.now - w.sampledAt) + ' ms old');
    return { ok: p.length === 0, problems: p };
  }

  /** Combine several INDEPENDENT runs/hosts: sums only quantities that are additive across separate measurements (time-disjoint wall clocks are NOT summed). */
  function describeDoubleCounting(parts) {
    // Utility for tests/tools: given per-worker reports that wrongly contain process-wide fields, say how far off a naive sum would be.
    const naiveRss = parts.reduce((n, x) => n + (x.rssBytes || 0), 0), real = Math.max(...parts.map((x) => x.rssBytes || 0));
    return { naiveRssSum: naiveRss, singleProcessRss: real, overstatementFactor: real ? naiveRss / real : null };
  }

  return { UNITS, SOURCES, sampleProcess, sampleWorkerSelf, sampleNativeRss, RunMonitor, buildReport, validate, describeDoubleCounting };
});
