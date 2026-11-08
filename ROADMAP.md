# EightMax Windows 3.3 remaining work

1. Run `Run self-tests.bat`, `Compare processing modes.bat` and `Validate CUDA hardware.bat` on the
   owner's 13th-generation Core i7 / RTX 4060 Ti 8 GB / 16 GB Windows PC and keep the JSON reports.
   3.3 was cross-compiled on Linux and its source was built and tested on a GitHub-hosted Windows
   Server runner (no GPU, no interactive desktop). No physical NVIDIA GPU was available.
2. CUDA in external sampling: hand scoring is 0.3-0.6% of external-sampling training time (measured,
   reported as `gpuStageBound`), so offloading it cannot pay for PCIe transfers. A useful GPU workload
   would need a vectorised (all-hands) river/turn solver, which does not exist yet.
3. Calibrate automatic traversal for flops, preflop and 4+ seats. No exact reference is tractable
   there; 3.3 keeps the 3.2 prior for those cases.
4. Variance reduction for sampled CFR (baselines / VR-MCCFR). DCFR did not help under sampling
   (validation/3.3/accuracy-3.2-vs-3.3.json).
5. Better large-game accuracy measures. The trained-response probe is noisy and can be negative
   when the response is under-trained; it is an approximate unilateral estimate only.
6. Process-wide hard memory limits (3.3 reports peak RSS but does not enforce it), code signing and
   an executable icon.
