# EightMax 5.13 — the delivered archive on a hosted Windows runner

This is a run of the two launchers on GitHub's hosted Windows runner. It is not the target PC: the runner is a
virtual machine with 4 logical processors and no NVIDIA GPU. It shows that the launchers and the validation script
work on real Windows with Windows PowerShell 5.1; it says nothing about the RTX 4060 Ti or the 24-thread CPU.

- Run 45750249714, job 139676020842, commit 37a06b0, workflow `.github/workflows/eightmax-5.13-windows.yml`
- Machine: Microsoft Windows Server 2025 Datacenter 10.0.26100, Intel Xeon Platinum 8573C, 4 logical processors, 16 GiB, PowerShell 5.1.26100.33822
- Archive: the delivered `EightMax-Windows-5.13.zip`, SHA-256 `e9ce4400488f42e6d53c5de6a259486bc8eb65238e3572c1d3664660dce9ef7c`, equal to the identity file; build `e9ce3436fa829e47`

| Launcher | Passed | Failed | Skipped | Exit | Script time |
|---|---|---|---|---|---|
| `Run 5.13 focused validation.bat` | 94 | 0 | 0 | 0 | 206.8 s |
| `Run 5.13 Windows validation.bat` | 287 | 0 | 1 | 0 | 829.9 s |

The one skipped check is the CUDA validation: "no usable NVIDIA CUDA device answered on this PC (NVIDIA driver
library not found): nothing about the GPU was tested".

What the run shows for 5.13 specifically:

- `SHA256SUMS.txt: every file matches (2116 files)` — the check that made both 5.12 launchers return 1 now passes.
- `--selftest513`: 14 of 14 checks; 21 of 21 payoff values and 24 of 24 trained states identical, bit for bit, to those recorded from the Linux build.
- `--satfield`: 10 of 10 values with the bits of the Linux build (fields of 4, 121 and 2,000 players).
- Satellite studies: one state for 1, 2 and 4 threads and for the cpu, auto, hybrid and gpu settings, equal to the Linux state.
- Self-tests 5.7.1 to 5.12: no failed or untested check.

One informational line to look at on the target PC: for the hybrid and gpu settings the script printed
"CPU (CUDA opened: True)" on this machine, which has no NVIDIA driver. The states are the CPU states and the check
passed; why the flag reads True without a driver was not investigated.

The complete job log is `windows-ci/job-139676020842.log.gz`.
