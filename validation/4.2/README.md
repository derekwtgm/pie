# EightMax 4.2 validation evidence

All files were produced on Linux (Ubuntu 24.04, 4 logical CPUs, Intel Xeon
2.1 GHz, GCC 13, MinGW-w64 GCC 13, Wine 9.0) unless stated otherwise. **Nothing
here was produced on a physical Windows desktop or an NVIDIA GPU.** Every CUDA
result below comes from the Linux CUDA driver test double
(`source/tests/cuda_driver_fixture.cpp`), which runs the real kernel source on
the CPU and, from 4.2, enforces the real driver's per-thread current-context
rules. It validates host-side logic (contexts, budgets, fallback, cleanup,
concurrency, numerical parity of the kernel source). It does not validate
PTX/SASS, the NVIDIA driver, timing or VRAM on your RTX 4060 Ti. Run
`Validate CUDA hardware.bat` on that PC for physical evidence.

| File | Produced by | Contents |
|---|---|---|
| `regression-tests.json`, `.txt` | `tools/run_tests.js` against the 4.2 Linux host and CLI | full suite: every 4.1 test plus `tests/v42.test.js` |
| `coverage42.json` | `tests/coverage42.cpp` | 4.1 defect reproduced; 4.2 table against a `std::set` reference |
| `cuda42.json` | `tests/cuda42.cpp` with the strict driver double | context per thread, push/pop balance, budgets, OOM, repeated init, Automatic rule |
| `cuda-context-repro.txt` | 4.1 and 4.2 `mwcli` on the 4.1 hardware-validator workload with the strict double | the 4.1 failure signature reproduced; 4.2 result |
| `gpustress-linux.json` | `build/linux/gpustress` with the strict double | concurrent multithreaded GPU jobs, cancellation on the GPU, re-initialisation |
| `wine-checks.txt` | `build/windows/*.exe` under Wine (no NVIDIA driver) | build id, CPU fallback, bit-identical EVs, `gpustress.exe` |
| `bench42.json`, `.log` | `tools/bench42.js` (4.1 `mwcli` vs 4.2 `mwcli`, 3 runs per row) | training identity, EV/gain/equity times and identity |
| `convergence42.json`, `.log` | `tools/convergence42.js` | exact eight-seat NashConv and per-seat gains at 4k–500k sampled deals, 3 seeds |
| `profile42.json` | `mwcli --gain/--ev` profile fields | where exact-evaluation time goes, 4.1 method vs 4.2 |
| `windows-release.ps1` | — | release verification used by `Run self-tests.bat` |

Reproduce from `source/`:

```
node tools/build.js && sh native/build.sh linux && sh native/build.sh windows
EM_TEST_HOST=build/linux/eightmax EM_TEST_MWCLI=build/linux/mwcli node tools/run_tests.js report.json
g++ -std=c++20 -O2 -Inative tests/coverage42.cpp -lpthread -o coverage42 && ./coverage42
g++ -std=c++20 -O2 -shared -fPIC tests/cuda_driver_fixture.cpp -o fx/libcuda.so.1
g++ -std=c++20 -O2 -Inative tests/cuda42.cpp -ldl -lpthread -o cuda42 && LD_LIBRARY_PATH=fx ./cuda42
LD_LIBRARY_PATH=fx build/linux/gpustress ../validation/4.0/fixtures/push8-icm.spec.json ../validation/4.0/fixtures/push8-icm.state 3 8
node tools/bench42.js <mwcli-4.1> build/linux/mwcli bench42.json 3
node tools/convergence42.js build/linux/mwcli convergence42.json
```
