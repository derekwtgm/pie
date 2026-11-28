# EightMax 5.17 on a hosted Windows runner

This is not your PC and not a GPU test. It is Windows Server 2025 on a GitHub-hosted virtual machine (4 logical
processors, 16 GiB, no NVIDIA device, **no OpenCL platform**). The launchers themselves say that such a report does
not count as physical Windows validation. Nothing here is evidence about method exact-hu on a graphics card: its
device checks were skipped, and say so.

## The delivered archive

Run 46086676305, job 140797753478, commit 9acbdab. Archive SHA-256
`c46b7e821f01ebd9823020f4bcb9fe82842d36fd61ab392eed4abcac35ac8eb0`, equal to the identity file; build `6efe7970626b6460`.
Xeon Platinum 8573C, Windows PowerShell 5.1.

| Launcher | Result |
|---|---|
| `Run 5.17 focused validation.bat` | exit 0. 150 passed, 0 failed, 1 skipped, 0 untested (624 s). The skip is the OpenCL GPU section |
| `Run 5.17 Windows validation.bat` | exit 0. 343 passed, 0 failed, 2 skipped, 0 untested (1233.9 s). The skips are the OpenCL GPU section and the CUDA section: nothing about the GPU was tested |

`mwcli.exe --selftest517`, in both launchers: 7 CPU checks passed (the states and the bits recorded on Linux, 2 to 4
threads, agreement with method `exact`, fallbacks, refusals), 6 device checks skipped.

## Earlier run (pre-release tree, which has no checksum file and fails that one check by construction)

| Run | Build | Result |
|---|---|---|
| 46060574786 (job 140713564441) | `6efe7970626b6460` | focused 149 passed, 1 failed, 1 skipped; full 342 passed, 1 failed, 2 skipped |

Logs: `windows-ci/`.
