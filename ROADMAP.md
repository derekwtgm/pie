# EightMax Windows 3.1 remaining work

1. Run `Run self-tests.bat`, `Compare processing modes.bat` and `Validate CUDA hardware.bat` on the
   owner's 13th-generation Core i7 / RTX 4060 Ti 8 GB / 16 GB Windows PC and keep the JSON reports.
   3.1 was cross-compiled and exercised under Wine on Linux only; no physical GPU was available.
2. Decide from those measurements whether any CUDA workload should be enabled by default. Hand
   scoring is too small a stage to win end-to-end on the CPU-bound sampled solvers; exact all-in
   equity enumeration is the workload most likely to benefit.
3. Native Compact and Detailed hand groups (`lib_information.js` features ported with an identical
   partition) so grouped abstractions also train natively. Today they train in JavaScript and the
   result says so.
4. Variance reduction for sampled CFR (baselines / VR-MCCFR) and a native exact-enumeration
   (vectorised) river solver; neither is implemented. Measured sampled error still falls at about
   1/sqrt(T).
5. Better large-game accuracy measures: the trained-response probe is too noisy on Exact-cards
   8-player games to bound exploitability usefully. Abstracted (bucketed) reference games would make
   approximate best responses tractable.
6. Code signing and an executable icon.

