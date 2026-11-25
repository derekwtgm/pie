#!/bin/bash
# Commits the files of <dir> to the results branch under runs/<run number>-<job>/ (retries when another job pushed first).
set -uo pipefail
dir=$1; job=$2; br=claude/eightmax-5.11-ci-results; url="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"; w=$(mktemp -d)
cd "$w"; git init -q .; git config user.name "eightmax-ci"; git config user.email "eightmax-ci@users.noreply.github.com"; git remote add origin "$url"
for try in 1 2 3 4 5 6; do
  if git fetch -q --depth 1 origin "$br" 2>/dev/null; then git checkout -q -B work FETCH_HEAD; else git checkout -q --orphan work 2>/dev/null || true; git rm -rfq . 2>/dev/null || true; fi
  mkdir -p "runs/${GITHUB_RUN_NUMBER}-$job"; cp -r "$dir"/. "runs/${GITHUB_RUN_NUMBER}-$job/"; git add -A; git commit -q -m "run ${GITHUB_RUN_NUMBER} ${job} (${GITHUB_SHA:0:10})" || { echo "nothing to publish"; exit 0; }
  if git push -q origin "work:$br"; then echo "published runs/${GITHUB_RUN_NUMBER}-$job"; exit 0; fi
  echo "push attempt $try failed; retrying"; sleep $((RANDOM % 8 + 2)); git reset -q --hard; git clean -fdq
done
echo "could not publish"; exit 1
