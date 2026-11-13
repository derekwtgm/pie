#!/bin/sh
# Run from the release root with original CLI, original timer, current CLI,
# current timer, peak_rss wrapper and destination JSON as six arguments.
set -eu
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
for name in 'Heads-up turn' 'Heads-up river' 'Three-player river' 'Six-player flop' 'Eight-player preflop' 'Eight-player linked' 'Short-stack' 'Tournament bubble' 'Eight-player final-table' 'Four-player flop'; do
 EM_SCENARIO="$name" node --max-old-space-size=768 validation/3.6/scenarios.js "$1" "$2" "$3" "$4" "$5" "$tmp/$name.json" --quick
done
python3 - "$tmp" "$6" <<'PY'
import json,sys,pathlib
parts=[json.loads(f.read_text()) for f in sorted(pathlib.Path(sys.argv[1]).glob('*.json'))]
result=dict(parts[0],scenarios=[s for p in parts for s in p['scenarios']])
assert len(result['scenarios'])==10
pathlib.Path(sys.argv[2]).write_text(json.dumps(result,indent=1))
PY
