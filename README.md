# EightMax Test Workbench — Windows CI validation branch
This branch exists only to run the workbench's Windows acceptance on a real GitHub-hosted Windows x64 runner.
`candidate/` holds the exact release ZIP under test (with its SHA-256); `ci/ci.ps1` extracts it and runs
`windows\Test-Release.ps1 -IncludeInstall`, the Node.js regression suite with the bundled runtime and the results collector,
printing every report into the job log. Hosted runners have no GPU and a virtual display: results here are not the target PC.
