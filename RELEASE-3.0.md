# EightMax Windows 3.0

Build 8ff0e71cd306a4f9. Extract the ZIP, open the EightMax folder, and launch EightMax.exe. The browser-only entry point is EightMax-Offline.html. The desktop program starts a local server and uses your browser as its interface.

## Choosing a study

Balanced is the default accuracy preset. CPU Only is the initial multiway scoring device. In Multiway choose Native C++ when eligible, Wide ranges, and Exact cards to train a supported game on the desktop host. Selecting Exact cards keeps distinct private hands and public histories while still sampling deals. You can enter several bet or raise sizes and unequal stacks. Betting frequencies describe the sizes and branches you entered.

| Study or processing stage | 3.0 implementation and limits |
|---|---|
| Two through eight active seats, flop, turn and river | C++ trains the full configured betting tree over sampled legal deals. Each seat draws from its weighted range. Whole-tuple rejection handles card collisions. Sampled boards and folded players' dealt cards remain fixed across the betting branches of a traversal. Seats already folded before an entered postflop spot contribute dead money where supplied. Their unknown cards are marginalized, with no input for a separate folded range. |
| Linked preflop through river | JavaScript constructs the legal action tree, including blind and ante posts, minimum raises, side-pot layers and eligibility. C++ traverses it, retains private cards through folds and carries the ordered public history through subsequent decisions. The flop is canonicalized independently of the turn and river. |
| Large games | The native path requires full betting traversal and exact hand keys. The desktop automatic full-tree attempt caps construction at 250,000 states. Sampled betting traversal and Detailed or Compact groups use JavaScript. A user-selected full tree that exceeds its limit reports an error. |
| Tournament ICM | C++ awards chip layers, adds awards to stacks behind, and computes absolute expected prize units. A finishing-set dynamic program handles up to 16 remaining players, including fixed off-table stacks. Simultaneous busts use hand-start stacks and split tied places. A per-worker cache checks complete chip outcomes before reuse. The UI preserves ICM on JavaScript fallback. |
| Chance sampling and regret updates | Native and JavaScript share the reference game and RNG sequence. Optional native river stratification uses equal-probability strata over at most 1,024 candidate joint tuples, frozen batches, and simultaneous updates. Linear or uniform weighting, CFR+ clipping, alternating updates and conditional own-hand enumeration retain their existing semantics. DCFR remains an experimental native CLI path. |
| CPU work | The CPU owns the RNG, legal-tree traversal, ICM, regrets, ordered merge and checkpoints. Workers read one frozen policy and reduce increments in deal order. Comparing worker counts keeps the batch size fixed. Changing the batch size changes the training algorithm. River hand scores are cached by private combination. |
| CUDA work | The embedded PTX module scores complete seven-card hands using integers. The host loads the NVIDIA driver dynamically and needs no CUDA Toolkit installation. Driver or JIT failure falls back to the CPU. The module was compiled with NVRTC 12.9 and independently assembled for sm_89. Driver compatibility and GPU execution require a machine with suitable hardware. |
| CPU and GPU scheduling | Automatic measures the complete hand-scoring stage, including host packing, copies and synchronization. It compares CPU, GPU and concurrent 25%, 50% and 75% GPU partitions, using an improvement margin and periodic recalibration by batch-size class. GPU Preferred compares CPU against full-device scoring. Hybrid requests concurrent scoring on a nontrivial batch. Calibration checks every returned score against the CPU. A failed launch, allocation, transfer or comparison causes CPU scoring of the original batch. Each committed deal is traversed once per requested update rule. |
| Memory | The host retains separate application and process budgets, resident-memory checks and browser memory reporting where available. The multiway engine estimates per-worker ICM and traversal storage, admits sparse rows within its table budget and stops cleanly on a budget boundary. The default CUDA buffer cap is 512 MiB. Growing the buffers requires leaving the greater of 1 GiB and 25% of device VRAM free. On an 8 GiB card the reserve is 2 GiB. The buffer report excludes driver/context and display allocations. OS memory pressure, allocator overhead and other processes can change available memory. |
| Recovery | Portable .emstudy checkpoints contain config, training tables and generator state with SHA-256. Native row payloads add CRC32 and a study tag. Postflop raw EMMW1 files remain readable. Linked games use EMMW3 so future cards cannot alias. Checkpoint export happens after scoring, traversal and merge have finished. CLI state replacement uses a same-directory temporary file. Legacy raw files have fewer integrity checks. |

## Accuracy and performance

The matched-deal study used the restricted three-player river in bench30.js, four deals per update, full betting traversal and three independent seeds. Scores are the largest exact unilateral response gains within that finite game. The intervals are 95% Student-t half-widths over seeds. Timing covers training on a Linux Intel Xeon Platinum 8573C. Startup, tree generation, state transfer and strategy evaluation are excluded from these timings.

| Sampled deals | 2.9 and 3.0 standard gain, BB | 3.0 stratified gain, BB | Mean standard training time, 2.9 / 3.0 |
|---:|---:|---:|---:|
| 4,000 | 0.3862 ± 0.1015 | 0.3872 ± 0.0435 | 0.021 / 0.022 s |
| 20,000 | 0.2003 ± 0.1048 | 0.1679 ± 0.0825 | 0.100 / 0.100 s |
| 50,000 | 0.1093 ± 0.0382 | 0.1071 ± 0.0124 | 0.250 / 0.250 s |
| 100,000 | 0.0856 ± 0.0221 | 0.0883 ± 0.0178 | 0.495 / 0.499 s |
| 250,000 | 0.0439 ± 0.0120 | 0.0414 ± 0.0110 | 1.234 / 1.237 s |

At a one-second training budget per seed, the harness checked a monotonic deadline every 64 updates. The following values use the actual completed strategy at the stopping point.

| Engine | Mean actual time | Mean largest gain, BB | 95% half-width |
|---|---:|---:|---:|
| 2.9 native CPU | 1.001 s | 0.0538 | 0.0093 |
| 3.0 native CPU | 1.001 s | 0.0564 | 0.0152 |
| 3.0 JavaScript | 1.006 s | 0.1865 | 0.0575 |

These runs did not establish a 3.0 accuracy-per-time advantage over native 2.9. The first sampled budget with mean standard response gain below 0.1 BB was 100,000 deals for both releases. Larger multiplayer studies in ACCURACY.json use sampled opponent responses; those estimates can miss stronger responses and do not certify an eight-player equilibrium.

## Worker scaling

The six-player full-tree river fixture used 64 updates, 16 deals per frozen batch and three runs per worker count. The table gives medians. All 15 runs produced the identical SHA-256 digest of the strategy rows. CPU percent is summed across threads. RSS is the native CLI process peak.

| Workers | Training time | Deals/second | Peak RSS | CPU utilization |
|---:|---:|---:|---:|---:|
| 1 | 0.421 s | 2,435 | 15.3 MiB | 100% |
| 2 | 0.328 s | 3,119 | 16.9 MiB | 176% |
| 4 | 0.266 s | 3,844 | 18.8 MiB | 283% |
| 8 | 0.254 s | 4,027 | 20.3 MiB | 427% |
| 9 | 0.284 s | 3,610 | 20.9 MiB | 394% |

## Running the hardware checks on Windows

1. Double-click **Run self-tests.bat** to exercise the Windows host and save the result.
2. Double-click **Compare processing modes.bat**. It runs the same seeded turn study in the four modes and writes **device-results.json** beside the executables. The report includes the requested and observed scoring device, training and process time, GPU buffer peak and final strategy digest. The CPU result supplies the comparison. This PowerShell check needs no Node installation.
3. The existing **GPU self-test.bat** tests the separate OpenCL heads-up path. A successful OpenCL test does not validate CUDA.
4. With Node 22 or later installed, run the following from the extracted EightMax directory for the JavaScript and native comparisons, multiple seeds and thread counts.

```
node source/tools/device_benchmark.js mwcli.exe hardware-benchmark.json
```

## Verification and open work

- The 172 automated regressions passed with zero failures and zero skips. Separate packaged-interface tests exercised the worker, ICM controls, checkpoint download/load, linked studies and exact replay. The Linux host passed the native communication, stop, malformed request, save/reload and parity checks. A real headless Chromium worker matched page-side JavaScript after 80,000 training deals. Browser restart, forced worker termination, interrupted writes, corrupt-generation recovery and simulated storage exhaustion also passed.
- The C++ warnings check passed with -Wall -Wextra -Wshadow -Werror. ThreadSanitizer, AddressSanitizer and UndefinedBehaviorSanitizer ran on native fixtures. LeakSanitizer was disabled because the host blocked its process inspection. cppcheck was unavailable.
- Both PE32+ x64 executables were rebuilt twice and matched byte for byte. The packaging gate matched both binary identifiers, the standalone interface and source, and rejected a deliberate mismatch. The SHA-256 manifest covers the source, reports and both executables. Neither executable is Authenticode-signed.
- GPU validation here comprised compilation, sm_89 assembly, CPU reference comparisons using a driver test double, deliberate numerical mismatch, allocation, transfer, missing-driver and memory-pressure failures. Hardware benchmark requests fell back to CPU. Physical CUDA execution, GPU utilization, transfer timing and a reproducible end-to-end hybrid advantage remain open. The new scheduler calibrates hand scoring only. Large board/equity enumeration, GPU regret reduction and whole-solver time-to-target planning remain open.
- Windows 3.0 execution remains unverified. The Windows compatibility runner aborted during initialization before reaching the application. Version 2.9 was previously confirmed by the owner on Windows. No test in this package was run on the owner's i7, RTX 4060 Ti or 16 GB system.
- Native action generation, large external-sampling trees, off-table player action models, adaptive importance sampling and full eight-player equilibrium certification remain open. Supported native studies use the JavaScript action-tree compiler and the exact betting configuration entered in the UI.
