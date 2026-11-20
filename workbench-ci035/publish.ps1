# EightMax Test Workbench 0.35.0 CI: commit a run's evidence into ci-results/0.35/<run>/ on the SAME development branch the run
# came from (GITHUB_REF_NAME), so it can be read without an Actions token. Pushes made with GITHUB_TOKEN start no new workflow.
param([string]$Source)
$ErrorActionPreference = 'Continue'
$branch = $env:GITHUB_REF_NAME; $dest = 'C:\em035-publish'; Remove-Item -Recurse -Force $dest -ErrorAction SilentlyContinue
$url = 'https://x-access-token:' + $env:GH_PUSH_TOKEN + '@github.com/' + $env:GITHUB_REPOSITORY + '.git'
git clone --quiet --depth 1 --branch $branch $url $dest 2>$null
$run = Join-Path $dest ('ci-results\0.35\run-' + $env:GITHUB_RUN_ID + '-' + $env:GITHUB_RUN_ATTEMPT); New-Item -ItemType Directory -Force $run | Out-Null
Get-ChildItem $Source -Recurse -File | Where-Object { $_.Length -lt 8MB } | ForEach-Object { $rel = $_.FullName.Substring($Source.Length).TrimStart('\'); $d = Join-Path $run (Split-Path $rel -Parent); New-Item -ItemType Directory -Force $d | Out-Null; Copy-Item $_.FullName (Join-Path $run $rel) }
Push-Location $dest
git config user.name 'eightmax-ci'; git config user.email 'eightmax-ci@users.noreply.github.com'
git add -A; git commit --quiet -m ('CI 0.35 run ' + $env:GITHUB_RUN_ID + ' results (' + $env:GITHUB_SHA.Substring(0,12) + ')')
for ($i = 0; $i -lt 5; $i++) { git push --quiet origin ('HEAD:refs/heads/' + $branch); if ($LASTEXITCODE -eq 0) { break }; git pull --quiet --rebase origin $branch; Start-Sleep -Seconds (5 * ($i + 1)) }
Pop-Location
