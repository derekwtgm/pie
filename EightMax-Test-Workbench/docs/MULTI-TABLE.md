# Ten-table architecture and measured capacity (0.23)

```
 simulator Table ──observe──> HandStateEngine ──accepted state──> requestFromState
        ▲                           │ rejected → table paused           │
        │ SimulatorAdapter          ▼                                    ▼
   TestExecutor <── validated decision ── SolverService (bounded queue, cache, timeouts)
   (modes, e-stop,                                  │
    stale/dup checks)                    StudyDecisionSource ── EightMax 5.1 study rows
```

* One `TableWorker` per table: own simulator, own `HandStateEngine`, own action log, own metrics, own recovery counters.
* Workers are async loops on **one JavaScript thread** (cooperative). A crash, corrupt state, stalled solver or bad frame in one worker is caught,
  logged, backed off and recovered (or marked failed) without touching others. This is isolation, not parallel CPU scaling.
* Shared `SolverService`: configurable worker count (default 2 concurrent decisions), per-table pending limit, global queue depth, exact-input cache with a
  byte budget that shrinks under memory pressure, per-request deadlines, cancellation of obsolete requests, stale-response discard keyed on state revision.
* Budgets (`DEFAULT_BUDGETS`): memory (RSS), active tables, solver workers, queue depth, pending per table, cache bytes, deadline, invalid-frame limit, recovery limit, stall watchdog.
  Under memory pressure (>90 %) the highest-numbered active table is held; held tables resume below 75 % or run sequentially if nothing else is running.
* `decision` = a table lookup in the study (≈25 ms for a never-seen tree node, microseconds afterwards). The benchmarks therefore measure orchestration cost,
  **not** the cost of solving. Training a study is separate (native CLI: 500 k updates ≈ 14 s on 4 threads on the Linux test machine).
* Decisions are only available where the trained study has a stored row. With 500 k native updates ≈ 99.5 % of decisions were solver-made; the rest were
  reported as `unavailable` and, only when "labelled fallback" is enabled, played by the scripted test policy and counted separately. Strict mode suspends the table instead.

## Measured (Linux container, Node v22, 4 logical Xeon CPUs @ 2.1 GHz, no GPU) — simulated tables only
Source: docs/0.23-benchmark-linux-simulated.json (100 hands per table, 500 k-update native study). **Not Windows, not the RTX 4060 Ti machine.**

| Tables | Hands | Wall ms | Hands/s | End-to-end p50 / p95 / p99 ms | Solver p95 ms | Queue wait p95 ms | Deadline misses | Solver share | Peak RSS MB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 100 | 1187 | 84 | 0.1 / 8.0 / 9.8 | 7 | 0 | 0 | 99.7 % | 212 |
| 2 | 200 | 443 | 451 | 0.1 / 0.7 / 6.2 | 1 | 0 | 0 | 99.9 % | 219 |
| 5 | 500 | 681 | 734 | 0.2 / 1.3 / 6.6 | 1 | 1 | 0 | 99.7 % | 245 |
| 8 | 800 | 951 | 841 | 0.4 / 2.6 / 7.3 | 2 | 2 | 0 | 99.5 % | 266 |
| 10 | 1000 | 950 | 1053 | 0.5 / 2.9 / 4.8 | 3 | 2 | 0 | 99.4 % | 267 |

The 1-table run pays the one-time cost of building tree-node views (cold); later runs reuse them. Observation latency p95 < 0.01 ms, reconstruction p95 < 0.06 ms.
GPU utilisation and VRAM: **not measured** (no GPU path is used). Demonstrated: ten simulated tables completing 100 hands each with zero deadline misses and zero crashes on this machine.
Not demonstrated: any Windows timing, screen-capture latency, a real client round trip, or heavy per-decision solving.

## 0.24 — what changed, and what was measured separately
* **Three measurements, never mixed.** (A) *lookup*: structured observation feed + precomputed-strategy lookups through the 0.23 scheduler (unchanged, `tools/multitable-benchmark.cjs`);
  (B) *pipeline*: every decision goes render → capture → recognise → reconstruct → execute → acknowledge, one thread versus worker threads (`tools/multitable-benchmark-024.cjs`);
  (C) *solving*: on-demand postflop studies, in-thread JS reference, native CLI and a worker-thread pool. Results: docs/0.24-benchmark-pipeline-linux-simulated.json and docs/0.24-benchmark-lookup-linux-simulated.json.
* **Separated responsibilities.** Capture (`CaptureSession`), recognition (`ImageObserver`), reconstruction (`HandStateEngine`, per table) and solving (`SolverService` + optional `WorkerThreadSource`) are separate objects;
  tables share only the solver service and its bounded queue (`maxQueue`, `maxPending` per table, priority, exact-input cache with memory-aware shrink).
* **Worker threads (`src/solver-pool.js`).** Decisions run in OS threads: they overlap on several cores; a runaway synchronous computation is terminated at `jobTimeoutMs` and the worker replaced; a decision made stale by the
  table moving on is really killed (`killedStale`); a crashed worker fails only its own request; a factory that cannot initialise is reported. Evidence: `tests/solver-pool.test.cjs` (including a three-table run in which one table's solver
  spins forever while the other two keep completing hands). The 0.23 cooperative scheduler cannot time out such a stall (also shown by a test). Browser builds keep the Web Worker + native-CLI route; the pool is Node-side.
* **Isolation of the image path.** Each `SingleTablePipeline` owns its capture session, observer, engine and executor; the stress run places two tables per worker thread.
* **Emergency stop, controlled recovery and checkpoints** are unchanged for the 0.23 scheduler; the pipeline adds `checkpoint()` / restore (reconstruction state + oracle table) with a mandatory re-agreement period.
* Per-table error logs: `rejections` per hand, executor log (5,000 entries), capture `events` (200), `unavailableReasons`.
* Not done: sharing one capture thread across tables, vision in worker threads (vision is ~40 ms per frame on the test machine and was measured on worker threads per table group), GPU, any real-client or Windows timing.

## 0.25 additions
* Resource reporting is corrected (docs/RESOURCE-ACCOUNTING.md). `MultiTableScheduler.run()` now returns `resources` (validated process CPU/RSS, no per-table multiplication). The memory governor is evaluated once before the first decision (0.24 flake).
* Existing scheduler capabilities (unchanged, tested): up to ten tables with separate state ownership, bounded solver queue and per-table pending limit, priority by table health, cancellation of obsolete requests on newer revisions, memory-pressure holds, fault isolation, restart from checkpoint, emergency stop, solver worker threads (`src/solver-pool.js`).
* Benchmarks (Linux, 4 logical CPUs, simulated): `reports/0.25-benchmark-lookup-linux-simulated.json` (lookup), `reports/0.25-benchmark-pipeline-linux-simulated.json` (frame processing → reconstruction → execution, and actual solving), `reports/0.25-stress-report*.json`. Lookup, pipeline and solving are separate measurements and are never mixed.
