# EightMax 5.15 on a hosted Windows runner

This is a hosted virtual machine without an NVIDIA GPU. It is **not** the target PC and does not count as physical
Windows validation; the script says so itself. Nothing about the GPU was tested.

## The delivered archive (run 45941066420, job 140315243640, commit c24f805)

* Archive: `release-5.15/EightMax-Windows-5.15.zip`, SHA-256
  `dbf88659928da424651349798f5913164490850398b68e10470a6d7a72c9cf7a`, equal to the identity file. Build `87b9f6e38b735cfb`.
* Machine: Windows Server 2025 Datacenter 10.0.26100, AMD EPYC 7763, 4 logical processors, 16 GiB, PowerShell 5.1.26100.33822.

| Launcher | Passed | Failed | Skipped | Untested | Seconds (script) | Exit |
|---|---|---|---|---|---|---|
| `Run 5.15 focused validation.bat` | 127 | 0 | 0 | 0 | 591.8 | 0 |
| `Run 5.15 Windows validation.bat` | 320 | 0 | 1 | 0 | 1292.4 | 0 |

The one skipped check is GPU / CUDA validation (no NVIDIA driver on the runner). The ten self-tests of the full
launcher passed 28, 24, 33, 32, 21, 26, 8, 14, 7 and 12 checks (5.7 to 5.15), none failed.

## Runs before the release (kept because they found a defect)

* `job-140201413007.log.gz`: first pre-release tree. Self-test check T2 (continued three-thread training with future
  hands) failed.
* `diag2-515.log.gz`: the same check repeated, 3 of 6 runs ended with exit code -1073740940 (0xC0000374, heap
  corruption reported by Windows). Never seen on Linux, under Wine or under the sanitizers.
* After replacing thread-local scratch vectors in the ICM routine by local ones: `diag3-515.log.gz`, 12 of 12 repeats
  clean; `job-140237788478.log.gz`, the pre-release tree of build 87b9f6e38b735cfb, self-test 12 of 12 twice (its one
  failed check was the archive manifest, which a pre-release tree does not have).
* The cause inside the toolchain was not established. The evidence is that the failure disappeared with the change,
  in 12 repeats plus the runs above; that is not proof of the cause.

Logs: `windows-ci/`.
