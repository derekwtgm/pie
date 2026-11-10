# EightMax Windows 3.7

Extract the entire ZIP, open EightMax.exe, choose **Multiway**, and find **Native checkpoint recovery**. Open a portable external-sampling study or select **Open latest on desktop**. The displayed update and sampled-deal counts appear after the host validates the checkpoint. Choose **Continue training**, **View starting-hand strategy**, or **Save native checkpoint**. Save before closing the study. **Checkpoint recovery details** lists historical generations, disk capacity, storage estimates and validation failures.

## Supported recovery paths

| Saved study | Supported path |
|---|---|
| Native external-sampling EMCP36 archive from 3.6 or 3.7 | Direct desktop restore, continued training, streamed export and root strategy inspection. The regular file/recovery controls also route large eligible archives to the host. |
| Older compatible JSON envelope with external EMMW4 state | Desktop streaming extraction and native restore. The original file can be kept and the resumed study exported to EMCP36. |
| Exact and full-traversal JavaScript table archives | Use the browser’s **Load saved training** or **Recover automatic checkpoint**. This path has a 2 GiB decoded ceiling and requires room for live JavaScript tables. |
| Browser-only offline application | Local JavaScript solving and compatible browser file import. Host-resident restoration requires EightMax.exe. |

One live native solver owns the reconstructed state. The browser requests progress, commands and small policy results. It can inspect root actions per hand. The full postflop explorer on a large host-resident study still requires a browser-loadable copy. Native restoration reserves space for tables and staging structures. An already open study occupies RAM until its replacement passes validation. Closing a previously saved study can free additional room.

The host reads the network in 64 KiB chunks. It checks the archive header, metadata, ordered SHA-256 manifest and decoded blocks using 256 KiB work buffers. A temporary decoded file supports rule replay and incremental reconstruction. Validation covers game and algorithm identity, row and action counts, uniqueness, finite table entries, grouped-hand encodings, counters, RNG and native CRC. Errors or cancellation discard the candidate. Checkpoints use the existing generation seals, index reconstruction and checked file replacement.

## Storage and memory settings

| Variable | Default | Meaning |
|---|---:|---|
| EIGHTMAX_CHECKPOINT_MIB | 2048 | Storage cap in MiB per new streaming archive, covering wire and decoded sizes. Configurable from 1 to 16384. |
| EIGHTMAX_CHECKPOINT_GENERATIONS | 3 | Retain 2 or 3 verified generations. Cleanup follows verified publication. Ambiguous legacy files require explicit recovery. |
| EIGHTMAX_CHECKPOINT_RESERVE_MIB | 128 | Disk headroom retained during checkpoint I/O. |
| EIGHTMAX_RESTORE_MIB | Automatic | Optional lower cap on live reconstruction, in addition to available RAM and process limits. |
| EIGHTMAX_APP_MIB | Half of physical RAM, capped at 8192 MiB | Native host plus reported browser memory. |
| EIGHTMAX_PROCESS_MIB | Up to 6144 MiB by default | Native process limit, bounded by the application limit. |

For files over 2 GiB, open PowerShell in the extracted EightMax folder, set the following policy and then launch the host.

```powershell
$env:EIGHTMAX_CHECKPOINT_MIB = '4096'
.\EightMax.exe
```

The preflight uses incoming wire bytes plus three times the decoded bytes plus 4 MiB of overhead, in addition to the disk reserve. Existing generations already occupy disk and are never credited as future free space. Host-created exports use a separate conservative allowance for raw and encoded scratch files. A live state can occupy several times its serialized size. Free space and RAM determine whether the configured storage cap can be used on a particular PC.

## Mathematics, performance and hardware

The original study settings and default estimator are preserved. The optional fold-payoff control variate estimates the remaining sampled continuation after conditioning on known terminal utilities. Opponent reach, sampling corrections and descendant updates are preserved. An independently executed finite-game best response evaluates both seats in the heads-up benchmark. Larger multiway experiments use a sampled single-seat deviation and report uncertainty. These measurements provide no full-game eight-player equilibrium bound.

The native engine avoids duplicated work in betting-state construction and certain pot and strategy lookups. The measured selector skips short studies, skips single eligible choices and caches results for an equivalent configuration and execution backend. Full CFR, CFR+, DCFR and external sampling remain available through their supported modes. The DCFR discount arithmetic retains representable binary64 negative-regret discounts.

Automatic, CPU Only, GPU Preferred and Hybrid modes remain available. Device allocations use separate limits, including a default 512 MiB scoring-buffer cap and display headroom. The CUDA scorer keeps the inherited PTX and architecture-specific device modules, including sm_89 for the RTX 4060 Ti. A measured CPU win can now be reused across short training calls. Irregular traversal and sequential regret commits stay on CPU. Run **Validate CUDA hardware.bat** to generate hardware-validation.json on the target machine. Run **Run self-tests.bat** to generate Windows-self-test.json.

The executables were cross-compiled on Linux. CPU solving and checkpoint restoration were executed natively on Linux. Physical Windows x64, an actual RTX 4060 Ti, CUDA speedup and target-machine time to accuracy remain unverified. No signed installer is included. Read validation/3.7/README.md for exact tests, measurements and reproduction instructions.


### Scope of validation

- No new GPU traversal, regret-update or terminal-utility kernel was enabled. Exact equity and independent batched hand scoring remain the GPU-eligible operations. Live estimates of total CUDA or browser-worker memory depend on what the driver and browser report. The native validation utility records actual routes, allocations and whole-calculation timings where available.
- The cost model and pilot cache preserve manual overrides. Short-budget and cache timings were measured on a finite river study. Selection quality at every eight-player ICM budget remains open. Matched native benchmarks give stage wall times. Per-function cache-miss and synchronization hardware counters were unavailable.
- The old and new versions use the same lossless block coding. A smaller archive for the same input was not measured. A full game with unrestricted bet sizes is larger than the finite abstractions in this release.
- The initial interactive solver can materialize state in its browser worker. For a native external-sampling state that is already large, use the desktop recovery controls or raw native CLI continuation. The release does not remove the browser's decoded-state ceiling.
- Approximate response gains use held-out samples. The exact two-player results apply only to the specified finite ranges and betting game. References for the underlying regret and variance-reduction methods are [Lanctot et al.](https://papers.nips.cc/paper_files/paper/2009/hash/00411460f7c92d2124a67ea0f4cb5f85-Abstract.html), [Schmid et al.](https://ojs.aaai.org/index.php/AAAI/article/view/4048) and [Brown and Sandholm](https://ojs.aaai.org/index.php/AAAI/article/view/4007).

## Measured release results

Build `d802f79f8736854f`. The complete Linux regression run passed **319** tests with zero failures, skips or timeouts. All 308 inherited regressions are present. The focused address/undefined behavior sanitizer runs passed 59 cases, and a four-worker ThreadSanitizer fixture completed without a race diagnostic. Hardware-labelled regressions include driver test doubles. Physical NVIDIA execution was unavailable.

### Genuine trained eight-player checkpoints

A continuous eight-player linked study used four sampled deals per update. At each milestone the native CLI restored the state, trained one update, and matched every byte of the uninterrupted solver’s next snapshot. The desktop HTTP path independently matched the counters, RNGs and row count after the same update. Size here means decoded state. Peak RAM is whole-host high-water RSS on Linux.

| State MiB | Completed updates | Committed deals | Desktop restore seconds | Host peak MiB |
| ---: | ---: | ---: | ---: | ---: |
| 149.14 | 24,000 | 96,000 | 4.52 | 519 |
| 271.39 | 48,001 | 192,004 | 6.80 | 871 |
| 519.03 | 100,002 | 400,008 | 12.70 | 1,589 |
| 1,032.34 | 212,003 | 848,012 | 20.43 | 3,195 |

A separate 3.6 trained archive contained 133,916,983 raw bytes. The desktop restored its 20,000 updates, trained seven more, saved, restarted with a corrupted index and reproduced the complete 20,007-update state. The SHA-256 was `706d96d53f507f2062c4ec22e5866809398b557d258c303f6f61452f1719e121`. A compatible 3.5 JSON envelope yielded the same hash. The longer training generation reached 296,284 committed updates before its 5,300 MiB table budget prevented a 2,050 MiB trained checkpoint.

### Synthetic storage and recovery

| Decoded test size, MiB | Strategy rows | Live restore seconds | Host peak MiB |
| ---: | ---: | ---: | ---: |
| 128 | 1,241,603 | 1.07 | 213 |
| 256 | 2,484,360 | 2.01 | 412 |
| 512 | 4,969,873 | 4.08 | 812 |
| 1024 | 9,940,900 | 8.02 | 1,610 |
| 2050 | 19,902,372 | 16.95 | 3,211 |

In the separate disk-generation test, the host saved 2,149,909,523 wire bytes in 31.20 seconds with 13.7 MiB peak RSS. The full download matched SHA-256. From a fresh host and deliberately damaged index, it reopened the live state in 41.41 seconds, used 3211 MiB at peak, and advanced from 128 to 129 updates. This fixture has synthetic row values. Corruption, low-disk refusal, cancellation and process termination have separate tests.

### Serialization comparison

| Version | Lossless archive, MiB | Encoder wall ms | Encoder CPU ms | CLI restore + update + export, s | CLI peak MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| 3.6 | 111.14 | 709 | 703 | 3.65 | 870.9 |
| 3.7 | 111.14 | 656 | 641 | 4.75 | 469.4 |

Both writers produced the same compressed bytes with the same metadata. Both CLIs produced the same canonical resumed state. The existing lossless coding is retained. The on-disk oracle and the native reconstruction path trade temporary storage and semantic validation time for lower peak RAM.

### Exact heads-up river benchmark

Two nine-hand ranges, a fixed river, linear external sampling, one deal per update and one thread. Exact exploitability is half the sum of both finite-game best-response gains, measured in BB. Positive paired reduction favours the optional 3.7 estimator. All confidence intervals below use seven paired seeds, individually at 95%.

| Budget | 3.6 mean BB | 3.7 optional mean BB | Paired reduction BB | 95% interval BB |
| --- | ---: | ---: | ---: | ---: |
| 4,000 deals | 0.4297 | 0.4165 | +0.0132 | [-0.0490, +0.0754] |
| 20,000 deals | 0.1990 | 0.1927 | +0.0062 | [-0.0409, +0.0534] |
| 50,000 deals | 0.1265 | 0.1160 | +0.0105 | [-0.0293, +0.0503] |
| 100,000 deals | 0.0881 | 0.0941 | -0.0060 | [-0.0351, +0.0230] |
| 250,000 deals | 0.0473 | 0.0524 | -0.0051 | [-0.0181, +0.0078] |
| 500,000 deals | 0.0358 | 0.0389 | -0.0032 | [-0.0091, +0.0027] |
| 250 ms | 0.0654 | 0.0619 | +0.0035 | [-0.0096, +0.0165] |
| 1,000 ms | 0.0384 | 0.0344 | +0.0040 | [-0.0048, +0.0129] |

Every interval includes zero. The optional estimator remains disabled by default. Time-to-accuracy observations at 0.10 and 0.05 BB, including seeds that missed the target, are in validation/3.7/time-to-accuracy.json.

### Native CPU timings by study

Median training times for three fixed seeds with matched updates, actual deals, betting rules, range weights and thread requests. The state-table body was byte-identical in all 30 pairs. Raw records include peak RAM, zero GPU allocation, tables, state visits and separately measured strategy quality at equal work and elapsed time. Negative sampled deviations are possible on held-out deals.

| Study | 3.6 ms | 3.7 ms |
| --- | ---: | ---: |
| Eight-player final-table ICM (linked preflop) | 80.27 | 98.16 |
| Eight-player linked preflop to river | 54.02 | 62.74 |
| Eight-player preflop shove/call | 26.95 | 32.50 |
| Four-player flop (3 sizes) | 21.15 | 20.79 |
| Heads-up river | 34.15 | 30.34 |
| Heads-up turn | 56.00 | 55.54 |
| Short-stack multiway all-ins (6-seat flop) | 12.17 | 10.73 |
| Six-player flop | 41.16 | 39.68 |
| Three-player river | 65.80 | 92.69 |
| Tournament bubble ICM (4 left, 3 paid, shove/call) | 5.29 | 5.53 |

The separate interleaved eight-player linked profile used 80 updates, 16 sampled deals per update, four requested workers, a 2,048 MiB table budget and nine runs per version. Process time includes initialization and state export. End-to-end and solver-only timings varied across runs.

| Version | Training ms | Whole CLI ms | Traversal ms | Merge ms |
| --- | ---: | ---: | ---: | ---: |
| 3.5 | 55.2 | 80.9 | 29.2 | 17.5 |
| 3.6 | 55.3 | 77.4 | 28.1 | 16.6 |
| 3.7 | 53.4 | 80.3 | 27.7 | 18.0 |

### Pilot overhead and GPU scope

| Selection condition | 3.6 pilot calls / wall ms | 3.7 pilot calls / wall ms |
| --- | ---: | ---: |
| short | 6 / 392.54 | 0 / 0.54 |
| single eligible | 3 / 185.78 | 0 / 17.28 |
| cold | 6 / 367.38 | 6 / 372.36 |
| repeat | 6 / 366.47 | 0 / 0.04 |

These selector timings are from one JS river study with the Fast preset. A cold race still evaluates candidate quality on three seeds. The four requested processing modes produced identical counters and strategy tables on the CPU-fallback machine. A physical RTX 4060 Ti end-to-end speedup, a general multiway accuracy improvement and a uniform native speedup remain open.
