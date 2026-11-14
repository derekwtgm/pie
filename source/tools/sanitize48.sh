#!/bin/sh
# EightMax 4.8 sanitizer pass for the 4.8 changes (sanitize45-47.sh cover the inherited ones).
#  1. UBSan (+float-cast-overflow) + ASan mwcli:
#     - mwcli --selftest48 (every step a child process: continuation fixture, 4.8 vs 4.7 evaluation
#       paths, deadlines, comparison classes, EMZ1 levels);
#     - tests/v48.test.js against the sanitized CLI (rank cache, hoisted pots, table caps under
#       1-4 threads, 16 MiB budgets, sampled intervals, comparison, dashboard, continuation);
#     - table-cache eviction stress: exact gains with 512/64/24/16 MiB (six-player flop) and 512/64 MiB
#       (four-player bubble) budgets and 1, 3, 8 threads must be identical.
#  2. ThreadSanitizer: exact six-seat response gains with 8 threads (seats in parallel, private
#     small-table caches, shared preflop table cache with the 4.8 cap) and the continuation suite.
# Any sanitizer report fails the pass.
# Usage: sh sanitize48.sh <source dir>     (EM_SAN_DIR=<dir> keeps and reuses the builds)
set -eu
src=$(CDPATH= cd -- "$1" && pwd)
if [ -n "${EM_SAN_DIR:-}" ]; then mkdir -p "$EM_SAN_DIR"; t=$(CDPATH= cd -- "$EM_SAN_DIR" && pwd); else t=$(mktemp -d); trap 'rm -rf "$t"' EXIT; fi
fx="$src/../validation/4.8/fixtures"
echo "== build (UBSan+ASan, TSan)"
[ -x "$t/ub/mwcli" ] || sh "$src/tools/build_sanitized_host.sh" "$src" "$t/ub" undefined,float-cast-overflow,address
[ -x "$t/ts/mwcli" ] || sh "$src/tools/build_sanitized_host.sh" "$src" "$t/ts" thread
fail() { echo "$1"; exit 1; }
scan() { if grep -q 'runtime error\|ERROR: AddressSanitizer\|WARNING: ThreadSanitizer\|ERROR: LeakSanitizer' "$@"; then grep -h 'runtime error\|ERROR: AddressSanitizer\|WARNING: ThreadSanitizer\|ERROR: LeakSanitizer' -A14 "$@" | head -80; exit 1; fi; }
echo "== UBSan+ASan: mwcli --selftest48"
rm -rf "$t/st48"; ASAN_OPTIONS=detect_leaks=1 "$t/ub/mwcli" --selftest48 "$fx" "$t/st48" > "$t/st48.json" 2> "$t/st48.err" || { tail -30 "$t/st48.err"; fail 'selftest48 failed under UBSan+ASan'; }
scan "$t/st48.err" "$t/st48/selftest48.json"; cat "$t/st48.json"
echo "== UBSan+ASan: table caches under memory pressure (16/24/64 MiB, 1-8 threads)"
"$t/ub/mwcli" "$fx/flop6.spec.json" 20000 2 "$t/f6.state" 512 >/dev/null
"$t/ub/mwcli" "$fx/bubble4-own.spec.json" 20000 2 "$t/b4.state" 512 >/dev/null
ref=""
for spec in flop6 bubble4; do
  st="$t/f6.state"; sp="$fx/flop6.spec.json"; [ "$spec" = bubble4 ] && { st="$t/b4.state"; sp="$fx/bubble4-own.spec.json"; }
  ref=""; budgets="512 64 24 16"; [ "$spec" = bubble4 ] && budgets="512 64"   # one bubble table is 17 MiB: smaller budgets enumerate per board (too slow under ASan)
  for mib in $budgets; do for th in 1 3 8; do
    printf '{"method":"exact","threads":%s,"memoryMiB":%s}' "$th" "$mib" > "$t/q.json"
    ASAN_OPTIONS=detect_leaks=1 "$t/ub/mwcli" --gain "$sp" "$st" "$t/q.json" > "$t/g.json" 2> "$t/g.err" || { cat "$t/g.err" | head -20; fail "gain failed ($spec, $mib MiB, $th threads)"; }
    scan "$t/g.err"
    bits=$(grep -o '"gainBits":"[0-9a-f]*"' "$t/g.json" | tr -d '\n')
    [ -z "$ref" ] && ref="$bits"
    [ "$bits" = "$ref" ] || fail "different gains with $mib MiB and $th threads ($spec)"
  done; done
  echo "  $spec: identical exact gains for every budget and thread count"
done
echo "== UBSan+ASan CLI: tests/v48.test.js"
ASAN_OPTIONS=detect_leaks=0 EM_TEST_MWCLI="$t/ub/mwcli" node --test --test-concurrency=1 "$src/tests/v48.test.js" > "$t/v48.log" 2>&1 || { grep -E '^not ok|rror' -A10 "$t/v48.log" | head -80; exit 1; }
grep -E '^# (pass|fail|skipped)' "$t/v48.log"; scan "$t/v48.log"
echo "== ThreadSanitizer: exact six-seat gains with 8 threads, shared preflop tables"
for sp in flop6 bubble4-own; do
  st="$t/f6.state"; [ "$sp" = bubble4-own ] && st="$t/b4.state"
  printf '{"method":"exact","threads":8,"memoryMiB":64}' > "$t/q.json"
  TSAN_OPTIONS=halt_on_error=1 setarch -R "$t/ts/mwcli" --gain "$fx/$sp.spec.json" "$st" "$t/q.json" > "$t/ts.json" 2> "$t/ts.err" || { head -40 "$t/ts.err"; fail "TSan gain failed ($sp)"; }
  scan "$t/ts.err"; grep -o '"nashConv":[^,]*' "$t/ts.json"
done
echo "== ThreadSanitizer: continuation suite (four-player fixture)"
rm -rf "$t/suite"; TSAN_OPTIONS=halt_on_error=1 setarch -R "$t/ts/mwcli" --continuation-suite "$fx/bubble4-own.spec.json" "$t/suite" quick 4 > /dev/null 2> "$t/suite.err" || { tail -30 "$t/suite.err"; fail 'TSan continuation suite failed'; }
scan "$t/suite.err"; grep -o '"checksPassed":[0-9]*,"checksFailed":[0-9]*' "$t/suite/continuation-suite.json"
echo "sanitize48: all passed"
