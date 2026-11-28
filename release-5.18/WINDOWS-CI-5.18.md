# EightMax 5.18 on a hosted Windows runner

This is not your PC and not a GPU test. It is Windows Server 2025 on a GitHub-hosted virtual machine (4 logical
processors, 16 GiB, no NVIDIA device, **no OpenCL platform**). The launchers themselves say that such a report does
not count as physical Windows validation. Nothing here is evidence about a graphics card: the OpenCL GPU section and
the CUDA section were skipped, and say so.

## The delivered archive

Run 46123333568, job 140912369364, commit 6e03f18. Archive SHA-256
`800a13e3c11e4b3474ada294071b5b8db5f38ae8260a3b43ceeaccd5724a1e2b`, equal to the identity file; build `23205cbc12cae290`.
Xeon Platinum 8573C.

| Launcher | Result |
|---|---|
| `Run 5.18 focused validation.bat` | exit 0. 161 passed, 0 failed, 1 skipped, 0 untested. The skip is the OpenCL GPU section |
| `Run 5.18 Windows validation.bat` | exit 0. 354 passed, 0 failed, 2 skipped, 0 untested. The skips are the OpenCL GPU section and the CUDA section: nothing about the GPU was tested |

`mwcli.exe --selftest518`, in both launchers: 8 of 8 checks passed (the rule's recorded table, the states and
translated files recorded on Linux by SHA-256, the recorded bits of the exact best response, what must hold, the
refusals, the recorded lines of `--offtree`).

## Earlier run (pre-release tree, which has no checksum file and fails that one check by construction)

| Run | Build | Result |
|---|---|---|
| 46111583534 (job 140876088821), AMD EPYC 7763 | `23205cbc12cae290` | focused 160 passed, 1 failed, 1 skipped; full 353 passed, 1 failed, 2 skipped |

Logs: `windows-ci/`.
