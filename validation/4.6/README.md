# Validation evidence for EightMax 4.6 (build 169a67d1905adb32)

| File | Environment | Content |
|---|---|---|
| `regression-tests.json` | Linux native | full suite on the final build: 449 passed, 0 failed, 0 skipped, 0 timed out |
| `regression-tests-4.5-baseline.json` | Linux native | the 4.5 source rebuilt here: 434 passed, 0 failed |
| `continuation/linux-dev-continuation-suite.json`, `wine/continuation-suite-wine-4.6.json` | Linux native; Windows build under Wine | `mwcli --continuation-suite` (development build on Linux; final `mwcli.exe` under Wine: 25/25), every process recorded |
| `continuation/wine-dev-continuation-suite.json` | Wine | same, development build, work folder with a space |
| `wine/wine45-checks-on-4.6.json` | Wine (not Windows) | the 22 inherited Wine checks on the final `mwcli.exe` |
| `sanitizers/` | Linux native | `sanitize46.txt`, `sanitize45-on-4.6.txt`, `cppcheck.txt` |
| `convergence/convergence46.json`, `convergence46-summary.txt`, `convergence46.log` | Linux native | ten-seed exploration study, 216 Holm-adjusted comparisons |
| `convergence/reanalysis45-log.json` | analysis | the 4.5 study re-tested on log NashConv |
| `bench46.json`, `bench46-exact-ev-remeasure.json` | Linux native | 4.5 vs 4.6, interleaved |
| `native-*.json`, `explorer-host-linux.json`, `checkpoint-sizes.json`, `*_smoke.log` | Linux native | `release.sh` post-build checks on the final build |
| `ARCHITECTURE-REVIEW.md` | review | Priority 15 |
| `windows-release.ps1` | Windows (to be run on your PC) | the script behind `Run self-tests.bat` |

Not here, because nothing ran on it: Windows PowerShell, a physical Windows kernel, an NVIDIA GPU.
Those results appear only once `Run self-tests.bat` and `Validate CUDA hardware.bat` have run on your PC.
