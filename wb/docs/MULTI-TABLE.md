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
