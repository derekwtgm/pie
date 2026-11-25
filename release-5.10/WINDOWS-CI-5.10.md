# EightMax 5.10: the delivered archive on a hosted Windows runner

This file is beside the ZIP and not inside it: it reports a run that tested the packaged archive, so it could only
be written after the archive existed. Nothing in `EightMax-Windows-5.10.zip` or its identity file was changed by it.

**What ran.** GitHub Actions workflow `.github/workflows/eightmax-5.10-windows.yml` on commit `d5d7fa4`, run
45565960391, job 139040694021, 25 November 2026, 22 minutes. It checks out `release-5.10/`, compares the SHA-256 of
`EightMax-Windows-5.10.zip` with `EightMax-Windows-5.10.identity.json`, extracts the archive into an empty folder
and runs the two launchers a user double-clicks, with `EIGHTMAX_NO_PAUSE=1`. The job fails unless both launchers
return 0. Raw log: `windows-ci/job-139040694021.log.gz`. The JSON and text reports are an artifact of the run
(`EightMax-5.10-windows-runner-reports`).

**Where.** Microsoft Windows Server 2025 Datacenter 10.0.26100; Intel Xeon Platinum 8370C, 4 logical processors;
16 GiB RAM; Windows PowerShell 5.1.26100.33822; a Hyper-V virtual machine with no NVIDIA GPU. The validation script
itself records "Physical Windows: False" for this machine.

| Step | Result |
|---|---|
| Archive against its identity file | SHA-256 `532d6a63a898883102d18fdee1b1bc21b969e27c002fcdc0fa63b737533a25d3` in both; `mwcli.exe --build-id`: `EightMaxBuild=7fa0e8c16d6c6ade` |
| `Run 5.10 focused validation.bat` | exit status 0. `mwcli.exe --selftest510`: 21 passed, 0 failed, 0 untested. Script (85.8 s): **51 passed, 0 failed, 0 skipped, 0 untested** |
| `Run 5.10 Windows validation.bat` | exit status 0. Self-tests 5.7 / 5.7.1 / 5.8 / 5.9 / 5.10: 28, 24, 33, 32, 21 checks, all passed. Script (709.3 s): **216 passed, 0 failed, 1 skipped, 0 untested** |
| The one skipped check | GPU / CUDA validation: "no usable NVIDIA CUDA device answered on this PC": nothing about the GPU was tested |

Checks of this run that had only been made under Wine or PowerShell 7 before:

* every file of the extraction against `SHA256SUMS.txt` (5,487 files), by Windows PowerShell 5.1;
* the eleven golden states; the default trainer's frozen-batch state for 1, 2 and 4 threads and the measured thread
  choice: one state, the state of the 5.6 binary;
* **`rbes`: one state for 1, 2 and 4 threads and the measured choice, equal to the state the Linux build wrote**
  (`1f735090...c8cfb4`); **CPU Only, Automatic, Hybrid and GPU-Preferred write that same state** (without a GPU the
  last two fall back to the CPU); the exact check of the estimator on a table trained on the runner;
* the 5.7.1 checkpoint and process-memory self-test, 24 of 24, natively;
* the reference responses of 5.8 and 5.9, the desktop host's refused-study checks, interruption, kill and resume,
  the checkpoint lock, the memory-budget stop, invalid configurations.

Measurements the script printed on this machine (information; 4 virtual processors):

| | Deals per second |
|---|---|
| `flop6-jack`, default trainer, frozen batches, 1 thread offered / 4 offered | 40,825 / 83,491 |
| `flop6-jack`, `rbes`, frozen batches, 1 thread offered / 4 offered | 11,583 / 21,125 |
| `flop6-jack`, default trainer, one deal per update | 41,320 |
| `flop3-kings-detailed`, default trainer, one deal per update | 45,420 |

**What this is and is not.** It is the first execution of the 5.10 Windows executables, of both launchers and of
`validate_windows510.ps1` under Windows PowerShell 5.1 on real Windows, on the exact archive that is delivered, and
every gate passed. It is NOT the target PC: a virtual machine with 4 processors instead of 24, another CPU, no GPU.
**No CUDA path of 5.10 has run on an NVIDIA GPU**, and nothing is known about 5.10 on the i7-13700F or the
RTX 4060 Ti until `Run 5.10 Windows validation.bat` is run there (WINDOWS-TESTS-5.10.md).

The repository's older workflow `windows.yml`, written for the 2.9 tree at the repository root, also ran on this
push, as it does for every push, and failed after a minute, as it did for the 5.9 pushes; it does not test 5.10.
