# Windows runner evidence for 4.5

Source: the repository's workflow `.github/workflows/windows.yml`, run by GitHub
Actions on `windows-latest` (a hosted **virtual machine**: real Windows, Windows
PowerShell 5.1, MSYS2 UCRT64 GCC building this source; **no NVIDIA GPU**; not the
target PC). These are the workflow's own records; the artifacts (reports, a
runner-built zip) are attached to the runs on GitHub and are not copied here.

| Run | Commit | Result |
|---|---|---|
| 29 (`43319303301`) | `1145202` | **failed** in "Test the fresh host on Windows": every check of `test_windows.ps1` up to the 4.4 PowerShell bit-pattern section passed, then the script stopped with `Method invocation failed because [System.Decimal] does not contain a method named 'Abs'` (a line written for 4.4 and never run on Windows before) |
| 30 (`43320034718`) | `a65eb2f` | self-test **passed** after the `[math]::Abs` fix, including the 4.5 section (IEEE sweep with digest `94fc3f6ed8426909`, coverage budgets 1/2/8/32 MiB x 1/4/8 threads, golden training hash, continuation after a capped evaluation, job-pool 413). Regression step **failed**: see run 32 |
| 32 (`43322182693`) | `94e42e8` | regression suite on Windows: **398 passed, 2 failed, 34 skipped, 0 timed out** (hardware-dependent: 12 run, 32 skipped — tests that need a Linux compiler toolchain or the Linux CUDA test double). The two failures: the inherited `4.2 coverage` test (compares the whole `coverage` object across thread counts; the first 4.5 layout put worker-count-dependent bytes in it) and one 4.5 test with a wrong assertion |
| 33 (`43326879611`) | `f703424` | **all steps succeeded**: compile, self-test on the fresh host, release assembly, release verification (device comparison script, build verification, interface smoke tests, self-test on the assembled release, accuracy report, complete regression suite — the step fails on any failed or timed-out test), concurrency stress (5 repetitions), parse of every PowerShell script, `validate_hardware.ps1` on CPU paths (including the new section 11) |
| 34 (`43331280269`) | `8393e24` | all steps succeeded |
| 35 (`43361922865`) | `7a498fc` | **all steps succeeded**. This commit has the source files of the released build `0e3de4013c49474a` (later commits change only built artifacts, reports and documents) |

What this does and does not show:

* It shows that the scripts behind `Run self-tests.bat` and `Validate CUDA
  hardware.bat` execute under Windows PowerShell 5.1, that a Windows build of
  this source passes them on CPU paths, and that the numerical, coverage-budget,
  checkpoint and deadline checks hold on a Windows kernel.
* The runner compiles with the MSYS2 UCRT64 toolchain; the executables in the
  package are cross-compiled with MinGW-w64 (MSVCRT) on Linux. They are built
  from the same source but are not the same binaries; the packaged binaries were
  run under Wine only.
* It says nothing about CUDA, VRAM, Automatic CPU/GPU scheduling, GPU
  performance, or the 24-thread i7 / RTX 4060 Ti PC. Deadline timings on a
  shared virtual machine are not those of the target PC.
