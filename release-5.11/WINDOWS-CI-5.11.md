# EightMax 5.11: the delivered archive on a hosted Windows runner

This file is beside the ZIP and not inside it: it reports a run that tested the packaged archive. Nothing in
`EightMax-Windows-5.11.zip` or its identity file was changed by it.

**What ran.** GitHub Actions workflow `.github/workflows/eightmax-5.11-windows.yml` on commit `e759515`, run
45663989692, job 139381046398, 25 November 2026. It compares the SHA-256 of the ZIP with the identity file, extracts
the archive into an empty folder and runs the two launchers a user double-clicks, with `EIGHTMAX_NO_PAUSE=1`. The job
fails unless both launchers return 0. Raw log: `windows-ci/job-139381046398.log.gz`.

**Where.** Microsoft Windows Server 2025 Datacenter 10.0.26100; AMD EPYC 9V74, 4 logical processors; 16 GiB RAM;
Windows PowerShell 5.1.26100.33822; a Hyper-V virtual machine with no NVIDIA GPU. The script records "Physical
Windows: False". **This is not the target PC and says nothing about CUDA.**

| Step | Result |
|---|---|
| Archive against its identity file | SHA-256 `df014e8030a9bda9412632e502fad3986266425123984afcdee4ada02027b002` in both; `mwcli.exe --build-id`: `EightMaxBuild=af452eaa0ea731be` |
| `Run 5.11 focused validation.bat` | exit status 0. `mwcli.exe --selftest511`: 26 passed, 0 failed, 0 untested. Script (69.6 s): **55 passed, 0 failed, 0 skipped, 0 untested** |
| `Run 5.11 Windows validation.bat` | exit status 0. Self-tests 5.7 / 5.7.1 / 5.8 / 5.9 / 5.10 / 5.11, all passed. Script (752.1 s): **248 passed, 0 failed, 1 skipped, 0 untested** |
| The one skipped check | GPU / CUDA validation: no NVIDIA device on the runner; nothing about the GPU was tested |

Made here for the first time on Windows with the delivered files: every file of the extraction against
`SHA256SUMS.txt` (5,679 entries) by Windows PowerShell 5.1; the philox64 reference state for 1, 2 and 4 threads and
all four processing modes equal to the state of the Linux build; the state trained to 10,000,200 updates and the
state at update index above 2^32 equal to the recorded ones.

**A defect found in this run's output, not repaired.** The introduction that `Run 5.11 focused validation.bat`
prints contains two wrong lines, produced when the launcher was derived from the 5.10 one: it says
`"trainingStreams" 5.11: the states of 5.11` and `kept by 5.11 states` where 5.10 is meant. Only the printed
description is wrong; the commands, the checks and the reports are not affected. Repairing it means a new archive
and a new hash, so it is left for the next release and stated here.
