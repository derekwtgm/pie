#!/bin/bash
# EightMax 5.11: the Windows programs under Wine. Usage: bash validation/5.11/wine511.sh <release root> <wrapper dir> <work dir>
# <wrapper dir> holds mwcli-wine and EightMax-wine: small scripts that start the Windows executable of <release root>
# under Wine with a minimal environment and pass on EightMax's own variables (validation/5.6/wine/wrapper-example.sh).
#  1. mwcli.exe --selftest511 (what "Run 5.11 focused validation.bat" runs first on a Windows PC), --selftest510,
#     --selftest59, --selftest58, --selftest571, --selftest57
#  2. the streams section of the Windows validation script, done by hand: the frozen-batch philox64 state of
#     validation/5.11/windows/streams with 1, 2 and 4 threads against the SHA-256 of the Linux build
#  3. the reference responses of 5.9 (validation/5.9/windows/response): mwcli.exe must still reproduce the bits
#  4. the 5.11 regression file with the Windows mwcli.exe in place of the Linux one
# Wine is not Windows: this is evidence about the Windows executables, not about a Windows PC.
set -u
root=$(cd "$1" && pwd); wr=$(cd "$2" && pwd); work=$3; out="$root/validation/5.11/wine"; rm -rf "$work" "$out"; mkdir -p "$work" "$out"; cd "$root"
win() { printf 'Z:%s' "${1//\//\\}"; }
"$wr/mwcli-wine" --build-id > "$out/build-id.txt" 2>&1; cat "$out/build-id.txt"
wine --version > "$out/wine-version.txt" 2>&1
sha256sum mwcli.exe EightMax.exe gpustress.exe > "$out/executables.sha256"
for st in 511:studies:all 510:studies:all 59:studies:all 58:studies:all 571:studies:all 57:validation/5.7/fixtures:; do
  IFS=: read -r n dir mode <<< "$st"; mkdir -p "$work/st$n"
  if [ -n "$mode" ]; then "$wr/mwcli-wine" --selftest$n "$(win "$root/$dir")" "$(win "$work/st$n")" $mode > "$out/selftest$n-wine.stdout" 2> "$out/selftest$n-wine.stderr"
  else "$wr/mwcli-wine" --selftest$n "$(win "$root/$dir")" "$(win "$work/st$n")" > "$out/selftest$n-wine.stdout" 2> "$out/selftest$n-wine.stderr"; fi
  echo "selftest$n exit $?" | tee "$out/selftest$n-wine.exit"; cp "$work/st$n/selftest$n.json" "$out/selftest$n-wine.json" 2>/dev/null
done
# 2. the streams section
python3 - "$root" "$wr/mwcli-wine" "$work" > "$out/streams-wine.json" <<'PY'
import sys, json, subprocess, hashlib, pathlib, os
root, cli, work = pathlib.Path(sys.argv[1]), sys.argv[2], pathlib.Path(sys.argv[3]); d = root / 'validation/5.11/windows/streams'; ref = json.loads((d / 'reference.json').read_text())
win = lambda p: 'Z:' + str(p).replace('/', '\\'); c = ref['threads']; rows = []
for n in (1, 2, 4):
    st = work / f'wide-{n}.state'; env = dict(os.environ); env['EIGHTMAX_THREAD_CHOICE'] = 'fixed'
    p = subprocess.run([cli, win(d / c['spec']), str(c['updates']), str(n), win(st), str(c['memoryMiB'])], capture_output=True, text=True, env=env)
    h = hashlib.sha256(st.read_bytes()).hexdigest() if p.returncode == 0 and st.exists() else ''; rows.append({'threads': n, 'exit': p.returncode, 'sha256': h, 'equalsTheLinuxBuild': h == c['stateSha256']})
ok = all(r['equalsTheLinuxBuild'] for r in rows)
print(json.dumps({'test': 'the streams section of validate_windows511.ps1 with mwcli.exe under Wine', 'expectedSha256': c['stateSha256'], 'threads': rows, 'passed': ok}, indent=1)); sys.exit(0 if ok else 1)
PY
echo "streams section (philox64 states for 1, 2, 4 threads against the Linux build) exit $?" | tee "$out/streams-wine.exit"
# 3. the 5.9 reference responses
python3 - "$root" "$wr/mwcli-wine" "$work" > "$out/reference-responses-wine.json" <<'PY'
import sys, json, subprocess, hashlib, pathlib
root, cli, work = pathlib.Path(sys.argv[1]), sys.argv[2], pathlib.Path(sys.argv[3]); d = root / 'validation/5.9/windows/response'; g = json.loads((d / 'golden59.json').read_text()); rows = []
win = lambda p: 'Z:' + str(p).replace('/', '\\')
for c in g['cases']:
    st = work / (c['name'] + '.state'); subprocess.run([cli, win(d / c['spec']), str(c['updates']), '1', win(st), str(c['memoryMiB'])], capture_output=True, text=True)
    sha = hashlib.sha256(st.read_bytes()).hexdigest() if st.exists() else ''
    r = subprocess.run([cli, '--response', win(d / c['spec']), win(st), win(d / c['request']), str(c['memoryMiB'])], capture_output=True, text=True); got, sums = [], []
    try:
        doc = json.loads(r.stdout); S = doc['summary']
        got = ['%d:%s:%s:%s:%s' % (s['seat'], s['sampled']['gain']['gainBits'], s['sampled']['statistics']['sampleVarianceBits'], s['exact']['gainBits'], s['exact']['bestResponseGainBits']) for s in doc['seats']]
        sums = [S['simultaneous']['bits']['sumOfResponseGainsLowerBound'], S['simultaneous']['bits']['nashConvLowerBound'], S['pooledIndependent']['bits']['sumOfResponseGainsLowerBound'], S['pooledIndependent']['bits']['bestSubset']]
    except Exception as e: got = ['error: ' + (r.stderr.strip()[-200:] or str(e))]
    rows.append({'name': c['name'], 'stateIdentical': sha == c['stateSha256'], 'responseBitsIdentical': got == c['seatBits'], 'summaryBoundsIdentical': sums == c['summaryBits']})
ok = bool(rows) and all(r['stateIdentical'] and r['responseBitsIdentical'] and r['summaryBoundsIdentical'] for r in rows)
print(json.dumps({'test': 'the 5.9 reference responses with the 5.11 mwcli.exe under Wine: the training state, the sampled and exact gains of every seat and the bounds of the summary, bit for bit as the 5.9 Linux build recorded them', 'cases': rows, 'passed': ok}, indent=1)); sys.exit(0 if ok else 1)
PY
echo "5.9 reference responses exit $?" | tee "$out/reference-responses-wine.exit"
# 4. the 5.11 regression file against the Windows program
EM_TEST_MWCLI="$wr/mwcli-wine" node --test --test-concurrency=1 --test-reporter=tap --test-name-pattern='5.11 self-test: every|5.11 streams: an independent|5.11 philox64|5.11 limits|5.11 studies' source/tests/v511.test.js > "$out/v511-wine.tap" 2>&1
echo "5.11 regression file (self-test, independent implementation, determinism, limits, studies) with mwcli.exe exit $?" | tee "$out/v511-wine.exit"; grep -E '^# (tests|pass|fail|skipped)' "$out/v511-wine.tap" | tr '\n' ' '; echo
cat "$out"/*.exit > "$out/summary.txt"; cat "$out/summary.txt"
