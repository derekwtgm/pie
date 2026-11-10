#!/bin/sh
# EightMax 4.1 sanitizer and static-analysis pass.
#  1. UBSan (+float-cast-overflow, no recover) + ASan builds of the COMPLETE desktop
#     host and mwcli (tools/build_sanitized_host.sh). 4.0 sanitized only mwcli and a
#     stress tool, so the HTTP job API (the 1e300 -> int64 conversion) never ran
#     under UBSan. Runs: tests/num_safe41.c (property tests), the numeric probe of
#     16 input paths (tools/numeric_ub_probe41.js), and tests/v39, v40, v41 against
#     the sanitized host/CLI.
#  2. ThreadSanitizer build of the desktop host: every concurrency, cancellation,
#     job and startup test (v34, v40, v41) with reports written to files; any report
#     fails the pass. Plus the 4.0 stress tool and parallel response gains (TSan mwcli).
#  3. cppcheck on mw.cpp with all evaluation headers (if installed).
# Usage: sh sanitize41.sh <source dir> [report.log]
set -eu
src=$(CDPATH= cd -- "$1" && pwd); n="$src/native"; t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
echo "== build (UBSan+ASan host and CLI, TSan host)"
sh "$src/tools/build_sanitized_host.sh" "$src" "$t/ub" undefined,float-cast-overflow,address
sh "$src/tools/build_sanitized_host.sh" "$src" "$t/ts" thread
gcc -O1 -g -fsanitize=thread -c "$n/json.c" -o "$t/jt.o"
g++ -std=c++20 -O1 -g -fsanitize=thread -ffp-contract=off -I"$n" "$n/mw.cpp" "$src/tools/ev_concurrency.cpp" "$t/jt.o" -lpthread -ldl -o "$t/evc_tsan"
echo "== num_safe.h property tests (UBSan+ASan)"
gcc -std=c11 -O1 -g -fsanitize=undefined,float-cast-overflow,address -fno-sanitize-recover=all -I"$n" "$src/tests/num_safe41.c" "$n/json.c" -lm -o "$t/ns" && "$t/ns"
echo "== numeric probe: 16 input paths against the sanitized host"
node "$src/tools/numeric_ub_probe41.js" "$t/ub/eightmax" "$src" "$t/probe.json" | tail -1
node -e 'const r=require(process.argv[1]);if(r.totals.undefinedBehaviour||r.totals.refused4xx!==r.totals.cases){console.error("numeric probe failed");process.exit(1)}' "$t/probe.json"
echo "== v39, v40, v41 against the UBSan+ASan host and CLI"
for f in v39 v40 v41; do
  ASAN_OPTIONS=detect_leaks=0 EM_TEST_HOST="$t/ub/eightmax" EM_TEST_MWCLI="$t/ub/mwcli" node --test --test-concurrency=1 "$src/tests/$f.test.js" > "$t/$f.log" 2>&1 || { tail -60 "$t/$f.log"; exit 1; }
  echo "$f:"; grep -E '^# (pass|fail|skipped)' "$t/$f.log"
done
echo "== ThreadSanitizer: concurrency, cancellation, jobs and startup tests on the TSan host"
mkdir -p "$t/tsanlog"
TSAN_OPTIONS="log_path=$t/tsanlog/r halt_on_error=0 second_deadlock_stack=1" EM_TEST_HOST="$t/ts/eightmax" EM_TEST_MWCLI="$t/ts/mwcli" \
  node --test --test-concurrency=1 --test-name-pattern='concurrency|desktop jobs|startup failure|worker start|response gains' "$src/tests/v34.test.js" "$src/tests/v40.test.js" "$src/tests/v41.test.js" > "$t/tsan.log" 2>&1 || { tail -60 "$t/tsan.log"; exit 1; }
grep -E '^# (pass|fail|skipped)' "$t/tsan.log"
reports=$(ls "$t/tsanlog" | wc -l); echo "ThreadSanitizer report files: $reports"
if [ "$reports" -ne 0 ]; then cat "$t"/tsanlog/* | head -80; exit 1; fi
echo "== ThreadSanitizer: 4.0 stress tool and parallel response gains (TSan mwcli)"
node "$src/tools/study40.js" "$src" push8 30 2 "$t/push8" "$t/ub/mwcli" 1 >/dev/null
node "$src/tools/study40.js" "$src" threeIcm 600 1 "$t/threeIcm" "$t/ub/mwcli" 1 >/dev/null
TSAN_OPTIONS=halt_on_error=1 setarch -R "$t/evc_tsan" "$t/threeIcm/spec.json" "$t/threeIcm/state" 3
echo '{"method":"exact","seats":[0,3,6],"threads":3}' > "$t/g.json"; echo '{"method":"sampled","samples":400,"threads":4}' > "$t/g2.json"
for q in g g2; do TSAN_OPTIONS=halt_on_error=1 setarch -R "$t/ts/mwcli" --gain "$t/push8/spec.json" "$t/push8/state" "$t/$q.json" > /dev/null; echo "tsan parallel gain $q ok"; done
echo "== cppcheck"
if command -v cppcheck >/dev/null; then
  out=$(cppcheck --enable=warning,portability --std=c++20 --language=c++ -q -I"$n" "$n/mw.cpp" 2>&1 | grep -E ': (error|warning|portability):' || true)
  new=$(printf '%s\n' "$out" | grep -E 'action_ev\.hpp|action_stats\.hpp|ev_control\.hpp|showdown_table\.hpp|num_safe\.h|explorer\.hpp' || true)
  [ -n "$out" ] && { echo "cppcheck findings (all files):"; echo "$out"; }
  if [ -n "$new" ]; then echo "cppcheck: findings in 4.1 evaluation code"; exit 1; fi; echo "cppcheck: no findings in 4.0/4.1 evaluation code"
else echo "cppcheck not installed: static analysis skipped"; fi
echo "sanitize41: all passed"
