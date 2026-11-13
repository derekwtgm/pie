# Remaining validation after 4.5

- Run `Run self-tests.bat` and `Validate CUDA hardware.bat` on the RTX 4060 Ti PC and keep the three JSON reports. 4.5 has run on a GitHub-hosted Windows virtual machine (real Windows and PowerShell 5.1, no GPU) and under Wine, never on the target PC and never on a physical NVIDIA GPU. `v45` in `hardware-validation.json` gives small / medium / large evaluations per processing mode in cold processes with VRAM and coverage peaks; `v44` gives the warm Automatic comparison.
- Automatic CPU/GPU scheduling is unchanged in 4.5: no change is justified without the measurements above. If cold Automatic is more than 15% behind the best fixed mode on the RTX 4060 Ti (finding in `v45.findings`), consider persisting the measured arm times per GPU, driver and thread count between runs.
- Training convergence: Latin-hypercube chance sampling and other opponent-exploration values did not improve exact NashConv (ten seeds, six games). Untested ideas that need more trainer code: stratification that survives card-conflict rejection in eight-handed deals (the 4.5 sampler falls back to independent draws for about 91% of eight-seat random-range deals), per-street weighting schedules, and a predictive regret update. Use the exact-NashConv protocol of `tools/convergence44.js` before enabling anything.
- Training does not scale with threads on the eight-seat linked study at 4 deals per update (1 and 4 threads take the same time in `bench45`): larger batches or a finer split of one deal's traversals would be needed.
- The ICM kernel is division-bound (1,024 divisions for eight players). 4.5 pairs them with SSE2 (1.4-1.5x); AVX2 would not help on the measured CPUs. A larger exact cache did not reduce time.
- Response-gain answers do not yet print a coverage ledger (the per-seat tables are pool-bounded and unit-tested; the action-EV answer prints `coverage.memory`).
- JavaScript full-traversal checkpoint restoration keeps its 2 GiB decoded ceiling in the browser (unchanged); the native engine streams large states.
- Exact best responses with several hands per seat in eight-player games and six-player flop exact EVs still take minutes.

# Remaining validation after 4.3

- Run Run self-tests.bat and Validate CUDA hardware.bat on the RTX 4060 Ti PC. v43 in hardware-validation.json reports cold vs warm GPU times per mode and thread count, opens/verifications per process (must be 1), idle release, cancellation and refusal recovery. Shared tables, lifecycle and scheduling were verified only with the Linux driver test double.
- If the warm GPU beats 24 CPU threads only for larger tables, tune EM_GPU_BATCH_CHUNKS and the 1.25x cost-model margin from the measured batchFixedSeconds / gpuNsPerEval; consider a fused on-device pattern kernel (needs the CUDA toolkit to rebuild the embedded module).
- DCFR(1,1,2) was much better on eight-player push/fold and worse on postflop river/turn games: study an automatic per-game choice (street-dependent weighting) with the convergence43 protocol before changing any default.
- Exact coverage beyond the in-memory limit (sorted external runs) if studies exceed 2-30 million information sets.
- Exact best responses with several hands per seat in eight-player games and six-player flop exact EVs still take minutes; consider caching subset utilities across terminals.

# Remaining validation after 4.2

- Run Run self-tests.bat and Validate CUDA hardware.bat on the RTX 4060 Ti PC. The 4.2 CUDA context fix is verified with a driver test double that enforces per-thread contexts; v42.evTables in hardware-validation.json confirms or refutes it physically (GPU-preferred rows must score far more than 65,536 boards on the GPU with no cudaErrors).
- With pattern counting fixed, board scoring is about half of an exact EV's remaining time; if the RTX measurements show a GPU gain, consider fusing pattern histograms into the board kernel (needs the CUDA toolkit to rebuild the embedded module).
- Exact NashConv for eight-player studies with real ranges remains expensive (about 2,000 showdown tables per evaluation with two hands per seat); a shared per-request table cache across seats would cut it further.

# Remaining validation after 4.1 (historical)

- Run Run self-tests.bat and Validate CUDA hardware.bat on the Windows PC with the RTX 4060 Ti 8 GB. No physical Windows desktop and no NVIDIA GPU were available for 4.1; hardware-validation.json reports physicalNvidiaExecution, complete-workload CPU/GPU/hybrid times, peak VRAM and the scheduler's decisions.
- If the RTX measurements show GPU tables are slower end to end, keep auto on the CPU (it decides from its own measurement); if they are faster, consider moving pattern counting (the larger share of push/fold evaluations) to the GPU.
- Sampled one-decision response gains scale only to ~2 threads on push/fold studies because a few seats dominate; split a seat's samples into blocks for finer parallelism.
- The 8-action simultaneous comparison measured 5.9% family-wise error (95% CI 5.0-7.1%) at n = 1,000; a bootstrap of the covariance estimate could bring it closer to 5%.
- Training convergence: no DCFR setting beat linear averaging; remaining candidates need code (variance-reduced external sampling, stratified chance sampling) and the same exact-NashConv protocol.
- Extend the browser reader beyond its 2 GiB decoded ceiling for JavaScript full-traversal studies (unchanged).

# Remaining validation after 3.9

- Run Run self-tests.bat and Validate CUDA hardware.bat on the Windows PC with the RTX 4060 Ti 8 GB; 3.9 was exercised only under Wine.
- Extend sampled multiway response gains beyond one node per seat (e.g. trained responses over a seat's whole subtree) and run 8-player studies past 50,000 deals with more seeds.
- Run equal-time convergence comparisons of candidate variance-reduction schemes using the 3.9 exact best-response tool before enabling any of them.
- Add a strategy-quality dashboard and hardware diagnostics panel to the interface (data already available from the host API).
- Move long EV/response-gain requests off the engine lock so other explorer queries stay responsive.
- Extend the browser reader beyond its 2 GiB decoded ceiling for JavaScript full-traversal studies.

# Remaining validation after 3.8

- Run Run self-tests.bat and Validate CUDA hardware.bat on the Windows PC with the RTX 4060 Ti 8 GB. 3.8 executables were cross-compiled and exercised only under Wine on Linux.
- Find the remaining cost in the eight-player linked preflop-to-river study (2-9% slower than 3.7 at 4 threads on long runs) with hardware cache and contention counters on the 13th-generation Core i7.
- Repeat the equal-time accuracy comparison with more seeds; 3 seeds did not establish a significant gain despite 13-28% more deals per second.
- Add an independent reference for grouped-hand (Compact/Detailed) explorer lookups.
- Extend the browser reader beyond its 2 GiB decoded ceiling for JavaScript full-traversal studies.

# Remaining validation after 3.6

- Run the two hardware validation batches on Windows with the RTX 4060 Ti 8 GB, including end-to-end timing and NTFS recovery under actual power loss.
- Extend independent response measurements to more seats, seeds and longer multiway ICM training horizons. Verify gains inclusive of algorithm calibration overhead.
- Extend the browser reader beyond its current 2 GiB decoded ceiling and reduce the live interactive strategy footprint.
- Profile cache misses, thread contention and transfer costs on the 13th-generation Core i7. Measure complete application and driver memory over long sessions.
