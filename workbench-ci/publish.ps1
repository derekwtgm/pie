# EightMax Test Workbench 0.33 CI: publish a run's evidence to the results branch so it can be read without an Actions token.
# Commits <Source> into runs/<stage>-<run id>/ of branch claude/workbench-0.33.0-ci-results (created if missing) with GITHUB_TOKEN.
param([string]$Source, [string]$Stage)
$ErrorActionPreference = 'Continue'
$branch = 'claude/workbench-0.33.0-ci-results'; $dest = 'C:\em-publish'
Remove-Item -Recurse -Force $dest -ErrorAction SilentlyContinue
$url = 'https://x-access-token:' + $env:GH_PUSH_TOKEN + '@github.com/' + $env:GITHUB_REPOSITORY + '.git'
git clone --quiet --depth 1 --branch $branch $url $dest 2>$null
if (-not (Test-Path (Join-Path $dest '.git'))) { New-Item -ItemType Directory $dest | Out-Null; Push-Location $dest; git init --quiet; git checkout --quiet -b $branch; git remote add origin $url; Pop-Location }
$run = Join-Path $dest ('runs\' + $Stage + '-' + $env:GITHUB_RUN_ID + '-' + $env:GITHUB_RUN_ATTEMPT)
New-Item -ItemType Directory -Force $run | Out-Null
Copy-Item -Recurse -Force (Join-Path $Source '*') $run
Push-Location $dest
git config user.name 'eightmax-ci'; git config user.email 'eightmax-ci@users.noreply.github.com'
git add -A; git commit --quiet -m ('CI ' + $Stage + ' run ' + $env:GITHUB_RUN_ID + ' (' + $env:GITHUB_SHA + ')')
for ($i = 0; $i -lt 4; $i++) { git push --quiet origin ('HEAD:refs/heads/' + $branch); if ($LASTEXITCODE -eq 0) { break }; git pull --quiet --rebase origin $branch; Start-Sleep -Seconds (5 * ($i + 1)) }
Pop-Location
