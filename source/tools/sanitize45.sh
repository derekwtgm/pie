#!/bin/sh
# EightMax 4.5 sanitizer and static-analysis pass: everything tools/sanitize44.sh ran, plus
#  5. tests/v45.test.js (non-timing tests: coverage budget at the evaluator, memory exhaustion,
#     IEEE sweep, trainer options, job pool, ICM kernel, side-pot property test) against the
#     UBSan+ASan host and CLI;
#  6. ThreadSanitizer mwcli with a 1 MiB coverage budget (three table generations, the key limit
#     and the sketch back-fill under 8 threads; a deadline during growth);
#  7. tests/coverage45.cpp and tests/icm45.cpp under TSan / ASan+UBSan.
# The 4.4 description follows.
# EightMax 4.4 sanitizer and static-analysis pass for the 4.4 changes.
#  1. UBSan (+float-cast-overflow, no recover) + ASan builds of the complete desktop
#     host and mwcli: tests/v44.test.js (IEEE 754 probes, bit patterns, desktop API,
#     partial results, coverage, Automatic arms on the CUDA test double) and
#     tests/v44_postflop.test.js. The wall-clock deadline tests are excluded here
#     (sanitized code is several times slower; they run on the release build).
#  2. ThreadSanitizer mwcli: the concurrent coverage set and the stop path under 8
#     threads: a sampled EV stopped by its time limit, a complete sampled EV, a
#     cancelled one, exact EV and exact and sampled response gains. Any report fails.
#  3. tests/coverage44.cpp under TSan and ASan+UBSan (also run by tests/v44.test.js).
#  4. cppcheck on mw.cpp with every evaluation header; findings in the files changed
#     in 4.4 fail the pass.
# Usage: sh sanitize45.sh <source dir>
set -eu
src=$(CDPATH= cd -- "$1" && pwd); n="$src/native"
# EM_SAN_DIR=<dir> keeps the sanitized builds there and reuses them on the next run (otherwise a temporary directory).
if [ -n "${EM_SAN_DIR:-}" ]; then mkdir -p "$EM_SAN_DIR"; t=$(CDPATH= cd -- "$EM_SAN_DIR" && pwd); else t=$(mktemp -d); trap 'rm -rf "$t"' EXIT; fi
fx="$src/../validation/4.0/fixtures"
echo "== build (UBSan+ASan host and CLI, TSan host and CLI)"
[ -x "$t/ub/mwcli" ] || sh "$src/tools/build_sanitized_host.sh" "$src" "$t/ub" undefined,float-cast-overflow,address
[ -x "$t/ts/mwcli" ] || sh "$src/tools/build_sanitized_host.sh" "$src" "$t/ts" thread
echo "== v44 (non-timing tests) and v44_postflop against the UBSan+ASan host and CLI"
ASAN_OPTIONS=detect_leaks=0 EM_TEST_HOST="$t/ub/eightmax" EM_TEST_MWCLI="$t/ub/mwcli" node --test --test-concurrency=1 \
  --test-name-pattern='IEEE 754 probes|carry IEEE 754 bit patterns|desktop API|partial sampled|4.4 coverage: |Automatic' "$src/tests/v44.test.js" > "$t/v44.log" 2>&1 || { grep -E '^not ok|error' -A8 "$t/v44.log" | head -80; exit 1; }
echo "v44:"; grep -E '^# (pass|fail|skipped)' "$t/v44.log"
ASAN_OPTIONS=detect_leaks=0 EM_TEST_MWCLI="$t/ub/mwcli" node --test --test-concurrency=1 "$src/tests/v44_postflop.test.js" > "$t/v44p.log" 2>&1 || { grep -E '^not ok|error' -A8 "$t/v44p.log" | head -80; exit 1; }
echo "v44_postflop:"; grep -E '^# (pass|fail|skipped)' "$t/v44p.log"
if grep -q 'runtime error\|ERROR: AddressSanitizer' "$t/v44.log" "$t/v44p.log"; then grep -h 'runtime error\|ERROR: AddressSanitizer' -A6 "$t/v44.log" "$t/v44p.log" | head -40; exit 1; fi
echo "== v45 (non-timing tests) against the UBSan+ASan host and CLI"
ASAN_OPTIONS=detect_leaks=0 EM_TEST_HOST="$t/ub/eightmax" EM_TEST_MWCLI="$t/ub/mwcli" node --test --test-concurrency=1 \
  --test-name-pattern='4.5 coverage budget \(evaluator\)|4.5 evaluation job pool|4.5 memory exhaustion|4.5 IEEE 754 sweep|4.5 trainer options|4.5 property test' "$src/tests/v45.test.js" > "$t/v45.log" 2>&1 || { grep -E '^not ok|error' -A8 "$t/v45.log" | head -80; exit 1; }
echo "v45:"; grep -E '^# (pass|fail|skipped)' "$t/v45.log"
if grep -q 'runtime error\|ERROR: AddressSanitizer' "$t/v45.log"; then grep -h 'runtime error\|ERROR: AddressSanitizer' -A6 "$t/v45.log" | head -40; exit 1; fi
echo "== ThreadSanitizer mwcli: concurrent coverage set and the stop path, 8 threads"
node "$src/tools/study40.js" "$src" icmFinal 20 2 "$t/icm" "$t/ub/mwcli" 1 >/dev/null
run() { name=$1; shift; TSAN_OPTIONS=halt_on_error=1 setarch -R "$@" > "$t/out.json" 2> "$t/err.txt" || { rc=$?; if grep -q 'ThreadSanitizer' "$t/err.txt"; then cat "$t/err.txt" | head -60; exit 1; fi; [ "$name" = cancelled ] || { echo "$name failed ($rc)"; head -5 "$t/err.txt"; exit 1; }; }
  if grep -q 'ThreadSanitizer' "$t/err.txt"; then head -60 "$t/err.txt"; exit 1; fi; echo "tsan $name ok"; }
echo '{"path":[],"hands":[3],"range":true,"method":"sampled","samples":2000000,"timeLimitMs":1500,"threads":8}' > "$t/q1.json"
echo '{"path":[],"hands":[],"range":true,"method":"sampled","samples":1500,"seed":3,"threads":8,"timeLimitMs":600000}' > "$t/q2.json"
echo '{"path":[],"hands":[0],"method":"exact","device":"cpu","maxVisits":2000000000,"threads":8,"timeLimitMs":600000}' > "$t/q3.json"
echo '{"method":"exact","seats":[0,1,2,3,4,5,6,7],"threads":8,"timeLimitMs":600000}' > "$t/q4.json"
echo '{"method":"sampled","samples":64,"seats":[0,3],"threads":8,"timeLimitMs":3000000}' > "$t/q5.json"
run "sampled EV stopped by the time limit" "$t/ts/mwcli" --ev "$t/icm/spec.json" "$t/icm/state" "$t/q1.json"
grep -q '"status":"partial"' "$t/out.json" || { echo 'expected a partial result'; exit 1; }
run "complete sampled EV" "$t/ts/mwcli" --ev "$t/icm/spec.json" "$t/icm/state" "$t/q2.json"
EM_CANCEL_AFTER_MS=700 run cancelled "$t/ts/mwcli" --ev "$t/icm/spec.json" "$t/icm/state" "$t/q1.json"
run "exact EV (shared tables, concurrent coverage)" "$t/ts/mwcli" --ev "$fx/push8-icm.spec.json" "$fx/push8-icm.state" "$t/q3.json"
grep -q '"evBits":\["402e0a51470d8f36","402f57218439052d"\]' "$t/out.json" || { echo 'TSan build: exact EV bits differ from the reference'; exit 1; }
run "exact response gains, eight seats" "$t/ts/mwcli" --gain "$fx/push8-icm.spec.json" "$fx/push8-icm.state" "$t/q4.json"
run "sampled response gains" "$t/ts/mwcli" --gain "$t/icm/spec.json" "$t/icm/state" "$t/q5.json"
echo '{"path":[],"hands":[3],"range":true,"method":"sampled","samples":30000,"seed":5,"threads":8,"coverageMiB":1,"timeLimitMs":3000000}' > "$t/q6.json"
echo '{"path":[],"hands":[3],"range":true,"method":"sampled","samples":2000000,"timeLimitMs":1200,"threads":8,"coverageMiB":2}' > "$t/q7.json"
run "sampled EV, 1 MiB coverage budget (growth, key limit, sketches)" "$t/ts/mwcli" --ev "$t/icm/spec.json" "$t/icm/state" "$t/q6.json"
grep -q '"withinBudget":true' "$t/out.json" && grep -q '"status":"keyLimitReached"' "$t/out.json" || { echo 'TSan build: expected a capped coverage set within its budget'; exit 1; }
run "sampled EV stopped by the time limit, 2 MiB coverage budget" "$t/ts/mwcli" --ev "$t/icm/spec.json" "$t/icm/state" "$t/q7.json"
grep -q '"withinBudget":true' "$t/out.json" || { echo 'TSan build: coverage above its budget'; exit 1; }
echo "== coverage45 and icm45 under TSan and ASan+UBSan"
g++ -std=c++20 -O1 -g -fsanitize=thread -I"$n" -I"$src/tests" "$src/tests/coverage45.cpp" -lpthread -o "$t/c45t"
TSAN_OPTIONS=halt_on_error=1 setarch -R "$t/c45t" quick > "$t/c45t.json" 2> "$t/c45t.err" || { echo "coverage45 under TSan FAILED"; head -40 "$t/c45t.err"; grep -o '{"check":"[^}]*"passed":false[^}]*}' "$t/c45t.json" | head; exit 1; }
echo "coverage45 tsan ok ($(grep -o '"passed":true' "$t/c45t.json" | wc -l) checks)"
g++ -std=c++20 -O1 -g -fsanitize=address,undefined -fno-sanitize-recover=undefined -I"$n" -I"$src/tests" "$src/tests/coverage45.cpp" -lpthread -o "$t/c45a"
"$t/c45a" quick > "$t/c45a.json" 2> "$t/c45a.err" || { echo "coverage45 under ASan+UBSan FAILED"; head -40 "$t/c45a.err"; exit 1; }
echo "coverage45 asan+ubsan ok ($(grep -o '"passed":true' "$t/c45a.json" | wc -l) checks)"
g++ -std=c++20 -O1 -g -fsanitize=address,undefined -fno-sanitize-recover=undefined -ffp-contract=off -I"$n" -I"$src/tests" "$src/tests/icm45.cpp" -o "$t/i45a"
"$t/i45a" 8000 > "$t/i45a.json" 2> "$t/i45a.err" || { echo "icm45 under ASan+UBSan FAILED"; head -40 "$t/i45a.err"; cat "$t/i45a.json"; exit 1; }
echo "icm45 asan+ubsan ok: $(cat "$t/i45a.json")"
echo "== coverage44 under TSan and ASan+UBSan"
g++ -std=c++20 -O1 -g -fsanitize=thread -I"$n" "$src/tests/coverage44.cpp" -lpthread -o "$t/c44t"
TSAN_OPTIONS=halt_on_error=1 setarch -R "$t/c44t" 20000 > "$t/c44t.json" 2> "$t/c44t.err" || { echo "coverage44 under TSan FAILED"; head -40 "$t/c44t.err"; grep -o '{"check":"[^}]*"passed":false[^}]*}' "$t/c44t.json" | head; exit 1; }
echo "coverage44 tsan ok ($(grep -o '"passed":true' "$t/c44t.json" | wc -l) checks)"
g++ -std=c++20 -O1 -g -fsanitize=address,undefined -fno-sanitize-recover=undefined -I"$n" "$src/tests/coverage44.cpp" -lpthread -o "$t/c44a"
"$t/c44a" 20000 > "$t/c44a.json" 2> "$t/c44a.err" || { echo "coverage44 under ASan+UBSan FAILED"; head -40 "$t/c44a.err"; grep -o '{"check":"[^}]*"passed":false[^}]*}' "$t/c44a.json" | head; exit 1; }
echo "coverage44 asan+ubsan ok ($(grep -o '"passed":true' "$t/c44a.json" | wc -l) checks)"
echo "== cppcheck"
if command -v cppcheck >/dev/null; then
  out=$(cppcheck --enable=warning,portability --std=c++20 --language=c++ -q -I"$n" "$n/mw.cpp" 2>&1 | grep -E ': (error|warning|portability):' || true)
  new=$(printf '%s\n' "$out" | grep -E 'action_ev\.hpp|action_stats\.hpp|ev_control\.hpp|showdown_table\.hpp|coverage\.hpp|ieee_probe\.hpp|num_safe\.h|explorer\.hpp|icm\.hpp' || true)
  [ -n "$out" ] && { echo "cppcheck findings (all files):"; echo "$out"; }
  if [ -n "$new" ]; then echo "cppcheck: findings in evaluation code"; exit 1; fi; echo "cppcheck: no findings in the evaluation code (action_ev, ev_control, showdown_table, coverage, ieee_probe)"
else echo "cppcheck not installed: static analysis skipped"; fi
echo "sanitize44: all passed"
