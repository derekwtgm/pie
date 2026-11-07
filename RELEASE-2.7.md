# EightMax Windows 2.7

Extract the ZIP into a folder and run EightMax.exe. Keep its console open.
The application opens locally in your browser and works offline. Alternatively,
open EightMax-Offline.html (JavaScript/WebAssembly engines). Windows 10/11 x64
are the intended platforms. This release is cross-compiled on Linux, not tested
on physical Windows hardware. See validation/2.7 for actual results.

## Changes

* Optional frozen-policy mini-batches for sampled multiway CFR: independent
  deals share a policy, increments are averaged, then committed once. This
  reduces sampling variance per update at the cost of more work per update.
  Batch scratch buffers are reused and charged to the strategy budget.
* Optional CFR+ clipping (configuration `regretMatching: "plus"`). Standard
  regret matching remains the default. CFR+ performed worse in our river test;
  it is experimental, not an accuracy upgrade claim.
* Explicit Fast/Balanced/High accuracy presets in multiway setup, plus custom
  batch size. Existing saved studies retain one-deal updates unless configured.
* Sampled stability diagnostics at up to 20 checkpoints, reporting actual root
  strategy changes. These are not convergence certificates. Exact games retain
  their exact best-response stopping condition. Multiway UI permits up to
  1,000,000 sampled updates or 250,000 exact updates; sample engine caps total
  updates at 10 million for bounded long-running numerical accumulation.
* Native compiler no longer uses fast-math. Baseline x64 fallback avoids
  SSE4.2 requirements; AVX2/FMA is selected only after runtime detection.
* Native estimated allocation guard defaults to 4096 MiB; set
  EIGHTMAX_MEMORY_MIB from 32 to 8192 before launching to override. This checks
  strategy allocation and saved-solution loading, not total process memory or
  every transient allocation. Tree construction and browser memory are extra.
* EIGHTMAX_THREADS accepts only integer 1–256. CPU topology is detected by the
  OS; no untested P-core/E-core affinity policy is imposed. A failed worker
  creation reduces the pool instead of waiting forever for a missing worker.
* Native saved solutions reject negative/oversized iterations and non-finite
  reported accuracy. Additional memory-failure checks protect header loading.
* New regression tests cover batching, CFR+, normalization, repeatable seeds,
  checkpoint continuation, input limits, and batched memory-stop recovery.

## Presets (sampled multiway solver)

| Preset | Deals/update | Strategy budget including batch scratch | Card grouping | Update budget |
|---|---:|---:|---|---:|
| Fast | 1 | 48 MiB | Compact | 1,000 |
| Balanced (new studies) | 4 | 112 MiB | Detailed | 10,000 |
| High accuracy | 16 | 224 MiB | Exact cards | 50,000 |

The 25 BB full-chart transfer reserves 224 MiB (displayed as Custom) so the
extra batch scratch space does not prematurely stop its 10,000-update example.

The presets do not silently change bet sizes, stacks, ante rules or payouts.
Exact-card sampling does not enumerate every deal. High accuracy is a budget
setting, not a promise of equilibrium; it stops at its strategy memory limit.
For eight-way linked studies, start in Balanced mode and inspect the measured
response tests. Memory figures estimate storage, not a strict RSS ceiling.
At a budget stop the incomplete batch is discarded; allocated empty information
sets and consumed random numbers remain checkpointed. Resume is reproducible.

## Mathematical scope and measurements

See ACCURACY-SUMMARY.md and validation/2.7/*.json for configurations, individual
seeds, timings and uncertainty. `compare27.js` runs identical game definitions
in isolated processes against either source tree. Response measurements are
exact unilateral gains in the specified finite river abstraction, not a claim
of eight-player unrestricted poker equilibrium. Seed intervals use a Student-t
interval with two degrees of freedom (three seeds), not an accuracy guarantee.
Larger batches should also be compared at equal deals and elapsed time.

Full betting traversal samples private deals and public runouts. External
sampling enumerates the updating player's actions and importance-corrects
sampled opponent actions, including the average-strategy sampling probability.
The new batch freezes policies across independent samples. Outcome sampling
was not added: its additional action sampling would introduce more variance
without evidence of benefit here. Native heads-up DCFR, exact multiway CFR+,
linear sampled weighting, perfect-recall card keys, ICM and side-pot handling
are retained. Multiplayer no-regret learning alone does not certify Nash.

## Preserved capabilities and remaining work

Two through eight players, linked preflop through river, UTG through BB,
multiple sizes, all-ins, side pots, chip EV, tournament ICM and offline operation
remain available. Default ante remains 0.1 BB per dealt player: eight players
post 0.8 BB in antes plus 1.5 BB blinds = 2.3 BB. BBA is optional.

This is an incremental working release, not completion of every item in the
requested research programme. In particular:

* No CUDA backend was added. There is no NVIDIA GPU available here to establish
  correctness or a practical speedup. The existing optional OpenCL backend and
  CPU fallback are retained. No RTX 3060 Ti performance claim is made.
* No physical i7/16 GB/Windows validation, GPU utilization benchmark, or CUDA
  transfer/VRAM measurements were possible. Run the included Windows tests.
* Multiway training remains in a JavaScript worker. Native CPU parallelism
  applies to the existing heads-up engine; eight-way native/GPU training is
  not implemented.
* No new depth-limited solver or continuation-value model is claimed. No
  eight-player equilibrium or full-poker accuracy claim is made.
* The existing 15–100 BB chart calibration is preserved, not independently
  regenerated. Its approximation labels and limitations still apply.
* Manual checkpoint save/load and deterministic resume are retained. Periodic
  durable automatic checkpoint saving, CPU/GPU utilization dashboards and
  comprehensive recovery from every allocation failure remain future work.
* Native .em8 solutions are view-only saves, as before; resumable multiway
  training uses .emstudy files. Keep the application open until saving finishes.

## Reproduce

Run `node --test source/tests/*.test.js` and `node source/tools/build.js`.
Build with `sh source/native/build.sh windows` using MinGW-w64 and winpthreads.
The Linux build uses the same source. Test the Windows executable with
`source/tools/test_windows.ps1` or the included Run self-tests.bat.
The report scripts and original version validation are included. Old reports
under validation/2.6 describe only that version and are not 2.7 test results.

Baseline browser sources are included under validation/2.7/baseline-2.6.
Reproduce the original comparison from the extracted EightMax folder:

    node source/tools/compare27.js validation/2.7/baseline-2.6 baseline.json baseline
    node source/tools/compare27.js source batch.json batch

The legacy metrics field `deals` remains an update counter for compatibility;
new `trainingDeals` reports the number of completed batch deals.
