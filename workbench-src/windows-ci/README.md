# Windows CI for 0.35.0

The 0.35.0 Windows executables were **built and tested on a GitHub-hosted Windows x64 runner** (repository `derekwtgm/pie`,
development branch `ccr-3ce34618-vgl6fa`). The runner is Windows Server 2025 with no GPU and a Hyper-V virtual display that CI sets to
1920 x 1080 at 100 % scaling. It has an interactive desktop session, so the input tests there use **real SendInput, a real visible
cursor and real windows**. It is **not** the target PC (Windows 11, i7-13700F, RTX 4060 Ti, 3840 x 2160 at 150 %).

Two workflows; both commit their logs and reports to `ci-results/0.35/run-<id>-<attempt>/` on the same branch:

1. **Build + test** (`.github/workflows/workbench-035.yml`, `workbench-ci035/ci.ps1`): takes the verified 0.33.0 ZIP (checksum
   `024614aa…`), overlays `workbench-src/`, compiles every executable with `windows/Build-Executables.ps1` (host, capture tool,
   input driver, test table with the .NET Framework C# compiler; WGC helper with the .NET 8 SDK), then runs the input driver
   self-test, the 0.35 Node tests, `tools/input-acceptance-035.cjs` (29 graded checks), `tools/simulator-benchmark-035.cjs`
   (1/2/5/8/10 tables, two workloads) and - in the `all`/`release` stages - the whole Node regression suite.
2. **Release ZIP validation** (`.github/workflows/workbench-035-validate.yml`, `workbench-ci035/validate-zip.ps1`): checks the exact
   release ZIP's SHA-256, extracts it and runs the manifest check, the self-test, the input acceptance, the benchmark, the release
   acceptance with install/uninstall and the whole Node suite with the bundled runtime - without rebuilding anything.

`evidence/windows-ci-runs.json` lists each run, the SHA-256 of every executable it built or tested and what was observed;
`desktop/COMPONENT-VERSIONS.json` is generated from that evidence (a status is true only when a record names the exact SHA-256).
The 0.33 CI files are kept in `windows-ci/workbench-ci/` for reference.
