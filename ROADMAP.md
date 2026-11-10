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
