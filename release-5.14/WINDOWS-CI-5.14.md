# EightMax 5.14 — the delivered archive on a hosted Windows runner

This is a run of the two launchers and the equal-time quick trial on GitHub's hosted Windows runner. It is not the
target PC: the runner is a virtual machine with 4 logical processors and no NVIDIA GPU. It shows that the launchers,
the validation script and `eqtime.exe` work on real Windows with Windows PowerShell 5.1; it says nothing about the
RTX 4060 Ti, about 24 threads, or about any equal-time result.

- Run 45885811115, job 140136109963, commit 9c6cbca, workflow `.github/workflows/eightmax-5.14-windows.yml`
- Machine: Microsoft Windows Server 2025 Datacenter 10.0.26100, AMD EPYC 7763, 4 logical processors, 16 GiB, PowerShell 5.1.26100.33822
- Archive: the delivered `EightMax-Windows-5.14.zip`, SHA-256 `434e05cd2b137f9fbd9896c004f1185b95f5b89e41a0236d96b199fe3d163485`, equal to the identity file; build `57befd67c7c86ebe`

| Launcher | Passed | Failed | Skipped | Untested | Exit | Script time |
|---|---|---|---|---|---|---|
| `Run 5.14 focused validation.bat` | 107 | 0 | 0 | 0 | 0 | 423.2 s |
| `Run 5.14 Windows validation.bat` | 300 | 0 | 1 | 0 | 0 | 1133.2 s |
| `Run 5.14 equal-time quick trial.bat` | - | - | - | - | 0 | about 3.5 minutes |

The one skipped check is the CUDA validation: "no usable NVIDIA CUDA device answered on this PC (NVIDIA driver
library not found): nothing about the GPU was tested". The script itself states that this report does not count as
physical Windows validation.

What the run shows for 5.14 specifically:

- `SHA256SUMS.txt: every file matches (3195 files)`; `mwcli.exe`, `EightMax.exe` and `eqtime.exe` name the build.
- The equal-deals check of `eqtime.exe` (the program trains the recorded 20,000-deal states to the last bit of their
  NashConv): 9 of 9 values (pruning part) and 4 of 4 (threads part) identical to the Linux build, in the quick trial
  and again inside the focused validation.
- The quick trial printed "QUICK TRIAL: no decision" for every arm, as it must. It is a trial of the tool, not a
  result; no verdict of this run means anything.
- Compared with the pre-release tree on an earlier runner (run 45858910091: 106 + 299 passed, 1 failed each), the one
  failure there was the manifest that tree did not have; on the delivered archive it passes.

This runner was slower than the one of the pre-release run (423 s and 1133 s against 345 s and 963 s); the two
machines had different processors (EPYC 7763 here, EPYC 9V74 there).

The complete job log is `windows-ci/job-140136109963.log.gz`.
