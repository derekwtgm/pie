# CPU and memory accounting (0.25 correction)

## The 0.24 defect (reproduced)
`tools/pipeline-worker.cjs` called `process.cpuUsage()` and `process.memoryUsage().rss` inside each worker thread. Both are **process-wide**. The benchmark then summed them over workers:
2 workers reported `cpuMs 14,255` in `wallMs 3,564` = "4.0 cores busy" (the machine has 4; one table loop cannot use two cores each), and `peakRssBytesSum` added one resident set per worker (796 MB for what was a ~410 MB process).
(`docs/0.24-benchmark-pipeline-linux-simulated.json`).

## Rules now (`src/resource-monitor.js`)
| Quantity | Measured by | Never |
|---|---|---|
| Process CPU (ms; cores = cpuMs / elapsed) | the owning thread, first→last sample delta | summed over workers |
| Process RSS (bytes) | owning thread, maximum single sample | summed over workers |
| Worker heap (bytes) | the worker, its own isolate (`heapUsed`) | added to RSS |
| Worker busy time (ms) | worker `eventLoopUtilization().active` — an **estimate** (excludes native/GC threads) | presented as exact CPU |
| Native solver RSS | child-process resident set (`/proc/<pid>/status`, Linux; not measured elsewhere) | added to process RSS |
| GPU | **not measured**: no verified GPU path exists (`supported:false, measured:false`) | inferred from hardware presence |
Every report carries `units`, `sources`, `samplingIntervalMs` and `sampleCount`.

## Validation (`validate`)
Problems detected: `negative-elapsed`, `invalid-number`, `cpu-impossible` (> logical CPUs), `cpu-double-counted` (process CPU not explained by worker busy time), `memory-impossible`, `memory-double-counted`
(worker heaps exceed the whole RSS), `worker-process-wide-field` (a worker submitted rss/cpu — `workerReport` throws), `missing-worker-measurement`, `stale-metrics`, `too-few-samples`.
Tests: `tests/resource-monitor.test.cjs` (11), including a real 6-thread run and the multi-table scheduler.

## 0.25 results (same benchmark, corrected) — see `reports/0.25-benchmark-pipeline-linux-simulated.json`
