# EightMax 4.9 validation evidence

| Path | Content |
|---|---|
| `regression/` | full regression suite on the final Linux binaries (build 278035e3bb5bcaa6): run 1 (one test-only failure, kept as evidence) and run 2 after the test-only fix |
| `convergence/` | ten-seed convergence study (`tools/convergence48.js`): `conv49.json` (all statistics, 518 Holm-adjusted comparisons), `conv49.log` (summary), `conv49-per-seed.log` (every seed's NashConv curve) |
| `bench/` | 4.8 vs 4.9: `brbench-*` (exact / restricted / sampled response evaluation, `tools/brbench48.js`), `bench49-training-restore.json` (training, Automatic, EMZ1 restore; `tools/bench49.js` below) |
| `checkpoint-levels.json` | EMZ1 compression level study (`tools/checkpoint48.js`) |
| `wine/` | `--selftest47/48/49` of the shipped Windows executables under Wine 9.0 (not Windows) |
| `tools/bench49.js` | the training/restore benchmark (kept outside `source/tools` so the build fingerprint is unaffected) |
| `fixtures/` | spec used by `mwcli --selftest49` and `Run 4.9 checks.bat` |
| `build-linux.log`, `build-windows.log` | clean-build logs (no errors) |

Windows-runner evidence: RELEASE-4.9.md section 6 (GitHub Actions runs 48 and 49 on branch
ccr-b6b3ba71-s19btg; the workflow uploads `windows-selftest49.json` and `windows-emz-denied-temp.json`).
