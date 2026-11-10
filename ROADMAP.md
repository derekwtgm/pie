# Remaining validation after 4.1

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
