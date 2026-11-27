# EightMax 5.16 on a hosted Windows runner

This is not your PC and not a GPU test. It is Windows Server 2025 on a GitHub-hosted virtual machine (4 logical
processors, 16 GiB, no NVIDIA device). The launchers themselves say that such a report does not count as physical
Windows validation.

## The delivered archive

Run 46038080099, job 140638507130, commit c4b7aeb. Archive SHA-256
`e22eabf970d770897b7120339bfece276fc587bf0eaef7100d156fc83ef60c3e`, equal to the identity file; build `39600509cc5a98e8`.
AMD EPYC 9V74, Windows PowerShell 5.1.

| Launcher | Result |
|---|---|
| `Run 5.16 focused validation.bat` | exit 0. 140 passed, 0 failed, 0 skipped, 0 untested (477.7 s) |
| `Run 5.16 Windows validation.bat` | exit 0. 333 passed, 0 failed, 1 skipped, 0 untested (1068.5 s). The skip is the GPU section: nothing about the GPU was tested |

`SHA256SUMS.txt`: every file matches (5104 files), in both launchers.

## Earlier runs (pre-release trees, which have no checksum file and fail that one check by construction)

| Run | Build | Result |
|---|---|---|
| 45977215047 (job 140431843338) | `3490f9edf48ec1db`, **withdrawn** | focused 139 passed, 1 failed; full 332 passed, 1 failed, 1 skipped. The runner did not find the fault that withdrew this build; a check on the development machine did (RELEASE-5.16.md, Checkpoints) |
| 46009333112 (job 140540512666) | `39600509cc5a98e8` | focused 139 passed, 1 failed; full 332 passed, 1 failed, 1 skipped |

Logs: `windows-ci/`.
