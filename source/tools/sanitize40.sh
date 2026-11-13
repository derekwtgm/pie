#!/bin/sh
# EightMax 4.0 sanitizer and static-analysis pass for the evaluation changes:
#   - ThreadSanitizer: tools/ev_concurrency.cpp (concurrent exact, sampled,
#     response-gain and restricted tasks, cancellation mid-run, progress
#     readers, explorer queries) on river, turn and eight-player preflop ICM
#     studies, and the CUDA test double path (showdown tables on the "GPU");
#   - AddressSanitizer + UndefinedBehaviorSanitizer: the same stress tool, and
#     tests/v39.test.js and tests/v40.test.js against an ASan+UBSan mwcli
#     (every malformed request, fault-injected cancellation, timeout and
#     parity case runs under the sanitizers);
#   - cppcheck on mw.cpp (with all 4.0 headers) and the stress tool.
# Usage: sh sanitize40.sh <source dir>
set -eu
src=$(CDPATH= cd -- "$1" && pwd); n="$src/native"; t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
study() { node "$src/tools/study40.js" "$src" "$1" "$2" "$3" "$t/$1" "$4" >/dev/null; }
echo "== build"
gcc -O1 -g -fsanitize=thread -c "$n/json.c" -o "$t/jt.o"
g++ -std=c++20 -O1 -g -fsanitize=thread -ffp-contract=off -I"$n" "$n/mw.cpp" "$src/tools/ev_concurrency.cpp" "$t/jt.o" -lpthread -ldl -o "$t/evc_tsan"
gcc -O1 -g -fsanitize=address,undefined -c "$n/json.c" -o "$t/ja.o"
g++ -std=c++20 -O1 -g -fsanitize=address,undefined -fno-sanitize-recover=all -ffp-contract=off -I"$n" "$n/mw.cpp" "$src/tools/ev_concurrency.cpp" "$t/ja.o" -lpthread -ldl -o "$t/evc_asan"
g++ -std=c++20 -O1 -g -fsanitize=address,undefined -fno-sanitize-recover=all -ffp-contract=off -I"$n" "$n/mw.cpp" "$n/mwcli.cpp" "$t/ja.o" -lpthread -ldl -lz -o "$t/mwcli_asan"
g++ -std=c++20 -O2 -shared -fPIC "$src/tests/cuda_driver_fixture.cpp" -o "$t/libcuda.so.1"
gcc -O2 -c "$n/json.c" -o "$t/j.o"; g++ -std=c++20 -O2 -ffp-contract=off -I"$n" "$n/mw.cpp" "$n/mwcli.cpp" "$t/j.o" -lpthread -ldl -lz -o "$t/mwcli"
echo "== studies"
study threeIcm 600 1 "$t/mwcli"; study huTurn 300 1 "$t/mwcli"; study push8 30 2 "$t/mwcli"
echo "== ThreadSanitizer"
for s in threeIcm huTurn; do TSAN_OPTIONS=halt_on_error=1 setarch -R "$t/evc_tsan" "$t/$s/spec.json" "$t/$s/state" 3; done
echo '{"path":[1,1,1],"hands":[0],"method":"exact","threads":4,"device":"hybrid","timeLimitMs":600000,"maxVisits":2000000000}' > "$t/q8.json"
g++ -std=c++20 -O1 -g -fsanitize=thread -ffp-contract=off -I"$n" "$n/mw.cpp" "$n/mwcli.cpp" "$t/jt.o" -lpthread -ldl -lz -o "$t/mwcli_tsan"
for dev in cpu gpu hybrid; do
  sed "s/\"hybrid\"/\"$dev\"/" "$t/q8.json" > "$t/q8$dev.json"
  TSAN_OPTIONS=halt_on_error=1 setarch -R env LD_LIBRARY_PATH="$t" "$t/mwcli_tsan" --ev "$t/push8/spec.json" "$t/push8/state" "$t/q8$dev.json" > "$t/o$dev.json"
  node -e 'const r=require(process.argv[1]);console.log("tsan push8 device",r.execution.device,"gpuBoards",r.execution.gpuBoards,"ev",JSON.stringify(r.hands[0].ev))' "$t/o$dev.json"
done
echo "== AddressSanitizer + UndefinedBehaviorSanitizer"
for s in threeIcm huTurn; do "$t/evc_asan" "$t/$s/spec.json" "$t/$s/state" 2; done
for dev in cpu gpu hybrid; do env LD_LIBRARY_PATH="$t" "$t/mwcli_asan" --ev "$t/push8/spec.json" "$t/push8/state" "$t/q8$dev.json" > /dev/null; echo "asan push8 $dev ok"; done
echo "== tests/v39.test.js and tests/v40.test.js against the ASan+UBSan mwcli"
for f in v39 v40; do
  EM_TEST_MWCLI="$t/mwcli_asan" node --test --test-concurrency=1 --test-skip-pattern="desktop jobs|deterministic continuation" "$src/tests/$f.test.js" > "$t/$f.log" 2>&1 || { tail -60 "$t/$f.log"; exit 1; }
  echo "$f:"; grep -E '^# (pass|fail|skipped)' "$t/$f.log"
done
echo "== cppcheck"
# Two findings in unchanged 3.x training/checkpoint code (also reported for the
# untouched 3.9 source) are listed for information; any finding in a file added
# or changed for 4.0's evaluation work fails the pass.
out=$(cppcheck --enable=warning,portability --std=c++20 --language=c++ -q -I"$n" "$n/mw.cpp" "$src/tools/ev_concurrency.cpp" 2>&1 | grep -E ': (error|warning|style|portability|performance):' || true)
[ -n "$out" ] && { echo "cppcheck findings (all files):"; echo "$out"; }
new=$(printf '%s\n' "$out" | grep -E 'action_ev\.hpp|ev_control\.hpp|showdown_table\.hpp|cuda_score\.hpp|ev_concurrency\.cpp|explorer\.hpp' || true)
if [ -n "$new" ]; then echo "cppcheck: findings in 4.0 evaluation code"; exit 1; fi; echo "cppcheck: no findings in 4.0 evaluation code"
echo "sanitize40: all passed"
