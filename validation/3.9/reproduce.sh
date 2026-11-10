#!/bin/sh
# EightMax 3.9 validation, Linux (Ubuntu 24.04, Node 22, GCC 13, MinGW-w64 GCC 13 posix, Wine 9).
# usage: sh validation/3.9/reproduce.sh <mwcli built from the 3.8 source> [out-dir]
# Builds 3.9, runs the full regression suite, ASan/UBSan on the 3.8/3.9 native
# suites, the 3.8-vs-3.9 scenario, timing and convergence comparisons, and the
# Wine runs of the Windows mwcli.exe.
set -eu
top=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd); src="$top/source"; old=$1; out=${2:-"$top/validation/3.9"}
cd "$src"
node tools/build.js && sh native/build.sh linux && sh native/build.sh windows
export EM_TEST_HOST="$src/build/linux/eightmax" EM_TEST_MWCLI="$src/build/linux/mwcli"
node tools/run_tests.js "$out/regression-tests.json"
w=$(mktemp -d); trap 'rm -rf "$w"' EXIT
gcc -O1 -g -fsanitize=address,undefined -c native/json.c -o "$w/json.o"
g++ -std=c++20 -O1 -g -fno-omit-frame-pointer -fsanitize=address,undefined -fno-sanitize-recover=undefined -ffp-contract=off -Inative native/mw.cpp native/mwcli.cpp "$w/json.o" -lpthread -ldl -o "$w/mwcli-asan"
EM_TEST_MWCLI="$w/mwcli-asan" node --test --test-timeout=2400000 tests/v39.test.js tests/v38.test.js > "$out/sanitizers.log" 2>&1
node tools/scenarios39.js "$old" "$src/build/linux/mwcli" "$out/scenarios39.json"
node tools/timing39.js "$old" "$src/build/linux/mwcli" "$out/timing39.json" 7
node tools/convergence39.js "$old" "$src/build/linux/mwcli" "$out/convergence39.json"
printf '#!/bin/sh\nexport WINEDEBUG=-all\nfor a in "$@"; do case "$a" in /*) set -- "$@" "Z:$a";; *) set -- "$@" "$a";; esac; shift; done\nexec wine "%s" "$@"\n' "$src/build/windows/mwcli.exe" > "$w/wine-mwcli"; chmod +x "$w/wine-mwcli"
EM_TEST_MWCLI="$w/wine-mwcli" node --test --test-timeout=2400000 tests/v39.test.js > "$out/wine-v39.log" 2>&1 || true
