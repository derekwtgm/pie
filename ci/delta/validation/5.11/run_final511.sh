#!/bin/bash
# The validation chain of the 5.11 build on Linux, apart from the regression suite (which is run first, alone:
# EM_TEST_MWCLI=build/linux/mwcli EM_TEST_HOST=build/linux/eightmax node --test --test-concurrency=1 --test-reporter=tap source/tests/*.test.js > validation/5.11/tests/full-regression.tap).
# Usage: bash validation/5.11/run_final511.sh <release root> <5.10 mwcli> <work dir>
# <release root> holds build/linux/{mwcli,eightmax,gpustress} (source/native/build.sh) next to the release files.
# Evidence goes to validation/5.11/. Steps run even if an earlier one fails; exit codes are recorded in <work dir>/steps.txt.
# (Sanitizers, Wine, PowerShell, the experiment and the packaging have their own commands: sanitize511.sh, wine511.sh,
# powershell511.sh, convergence/convergence511.py, release511.py.)
set -u
root=$(cd "$1" && pwd); old=$(cd "$(dirname "$2")" && pwd)/$(basename "$2"); work=$3; mkdir -p "$work"; cd "$root"; S="$work/steps.txt"; : > "$S"; V=validation/5.11
cli="$root/build/linux/mwcli"; host="$root/build/linux/eightmax"
echo "build $("$cli" --build-id) $(date -u +%FT%TZ)" | tee -a "$S"
# 1. the self-tests of the Linux build, kept as evidence
rm -rf "$V/selftest"; mkdir -p "$V/selftest"
for st in 511:studies 510:studies 59:studies 58:studies 571:studies 57:validation/5.7/fixtures; do
  n=${st%%:*}; dir=${st##*:}; rm -rf "$work/st$n"
  if [ "$n" = 57 ]; then "$cli" --selftest$n "$root/$dir" "$work/st$n" > "$V/selftest/selftest$n-linux.stdout" 2> "$V/selftest/selftest$n-linux.stderr"
  else "$cli" --selftest$n "$root/$dir" "$work/st$n" all > "$V/selftest/selftest$n-linux.stdout" 2> "$V/selftest/selftest$n-linux.stderr"; fi
  echo "selftest$n (Linux) exit $?" | tee -a "$S"; cp "$work/st$n/selftest$n.json" "$V/selftest/selftest$n-linux.json" 2>/dev/null
done
# 2. the recorded tables of --selftest511 are what this build writes (a fresh recording equals the three shipped files)
rm -rf "$work/record"; "$cli" --selftest511 "$root/studies" "$work/record" record > "$V/selftest/record511.stdout" 2> /dev/null; rc=$?
same=0; for f in selftest511_golden.hpp selftest511_reference.hpp selftest511_limits.hpp; do cmp -s "$work/record/$f" "$root/source/native/$f" && same=$((same+1)); done
echo "recorded tables of selftest511: recording exit $rc, $same of 3 files identical to the shipped ones" | tee -a "$S"
# 3. independent implementations, against this build
mkdir -p "$V/independent"
python3 source/tools/independent_streams511.py selfcheck "$cli" > "$V/independent/streams511-selfcheck.json" 2> "$V/independent/streams511-selfcheck.stderr"; echo "independent training streams (5.11) selfcheck exit $?" | tee -a "$S"
python3 source/tools/independent_stats59.py selfcheck "$cli" > "$V/independent/stats59-selfcheck.json" 2> "$V/independent/stats59-selfcheck.stderr"; echo "independent statistics (5.9) selfcheck exit $?" | tee -a "$S"
gcc -O2 -o "$work/overlap" source/tools/streams511_overlap.c && "$work/overlap" 101 > "$V/independent/streams510-overlap-seed101.json"; echo "coincidences of the 5.10 streams (arithmetic) exit $?" | tee -a "$S"
# 4. the desktop host: refused studies (nine checks), the interface in a browser, the stability run
node source/tools/host_refusal59.js "$host" "$root" "$V/host-refusal59-with-the-5.11-host.json" > "$V/host-refusal59-with-the-5.11-host.stdout" 2>&1; echo "desktop host, refused studies exit $?" | tee -a "$S"
mkdir -p "$V/ui" "$V/stability"
node validation/5.9/study_ui59.js "$host" "$root" "$V/ui" > "$V/ui/study_ui59.stdout" 2>&1; echo "interface in a browser exit $?" | tee -a "$S"
node validation/5.11/stability511.js "$host" "$root" "$V/stability" --minutes=3 > "$V/stability/stability511.stdout" 2>&1; echo "stability (3 minutes) exit $?" | tee -a "$S"
# 5. identical training states: the unchanged 5.10 binary against this build (thread counts, trainer options, hand groups, table limits)
rm -rf "$work/identity" "$V/identity"; mkdir -p "$V/identity"
python3 source/tools/identity57.py "$old" "$cli" "$work/identity" > "$V/identity/identity-against-5.10.log" 2>&1; echo "identity against 5.10 exit $?" | tee -a "$S"
cp "$work/identity"/summary.json "$V/identity/" 2>/dev/null; gzip -9 -c "$work/identity/identity.jsonl" > "$V/identity/identity.jsonl.gz" 2>/dev/null; tail -3 "$V/identity/identity-against-5.10.log" | tee -a "$S"
echo "== done $(date -u +%H:%M:%S)" | tee -a "$S"; cp "$S" "$V/run-final511-steps.txt"
