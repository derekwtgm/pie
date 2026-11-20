#!/bin/sh
# EightMax Test Workbench 0.35.0 - package the release from: the verified 0.33.0 ZIP + workbench-src/ overlay + the executables
# BUILT ON WINDOWS by a CI run (ci-results/0.35/<run>/bin, with that run's build-evidence.json) + Windows CI evidence + reports.
# Usage: sh workbench-ci035/package.sh BASE_ZIP CI_RUN_DIR OUT_DIR [WGC_RUN_DIR]
# WGC_RUN_DIR: a run whose (large, unchanged-source) WGC helper was published; its build-evidence entry is used for that file.
set -eu
base=$1; run=$2; out=$3; wgcrun=${4:-$2}; here=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
name=EightMax-Test-Workbench; tree="$out/$name"; zip="$out/EightMax-Test-Workbench-0.35.0-Simulator-Controls.zip"
rm -rf "$out"; mkdir -p "$out"
sh "$here/workbench-ci035/assemble.sh" "$base" "$tree"
for e in EightMaxWorkbench.exe EightMaxCapture.exe EightMaxInput.exe EightMaxTestTable.exe; do
  [ -f "$run/bin/$e" ] || { echo "missing Windows-built $e in $run/bin" >&2; exit 1; }
  cp "$run/bin/$e" "$tree/desktop/bin/$e"
done
[ -f "$wgcrun/bin/EightMaxWgc.exe" ] || { echo "missing Windows-built EightMaxWgc.exe in $wgcrun/bin" >&2; exit 1; }
cp "$wgcrun/bin/EightMaxWgc.exe" "$tree/desktop/bin/EightMaxWgc.exe"
python3 - "$run/build-evidence.json" "$wgcrun/build-evidence.json" "$tree/evidence/build-evidence.json" <<'PY'
import json, sys
a = json.loads(open(sys.argv[1], encoding='utf-8-sig').read()); w = json.loads(open(sys.argv[2], encoding='utf-8-sig').read())
a['outputs']['desktop/bin/EightMaxWgc.exe'] = dict(w['outputs']['desktop/bin/EightMaxWgc.exe'], buildRun=w['ci']['runId'])
a['note'] = 'EightMaxWgc.exe comes from Windows CI run %s (same source; the large helper is published only by release-stage runs); everything else from run %s.' % (w['ci']['runId'], a['ci']['runId'])
open(sys.argv[3], 'w').write(json.dumps(a, indent=2) + '\n')
PY
# Evidence of Windows runs (from the CI results) and copies of the reports
python3 "$here/workbench-ci035/evidence.py" "$tree" "$here/ci-results/0.35"
( cd "$tree" && python3 tools/make-components.py >/dev/null && python3 tools/build.py >/dev/null )
find "$tree" -name '*.pdb' -delete
( cd "$tree" && python3 tools/make-manifest.py )
( cd "$out" && rm -f "$zip" && zip -q -r -X "$(basename "$zip")" "$name" )
( cd "$out" && sha256sum "$(basename "$zip")" > "$(basename "$zip").sha256" && cat "$(basename "$zip").sha256" && unzip -tq "$(basename "$zip")" )
