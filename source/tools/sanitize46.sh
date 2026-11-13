#!/bin/sh
# EightMax 4.6 sanitizer pass for the 4.6 changes (run tools/sanitize45.sh as well for the inherited ones).
#  1. UBSan (+float-cast-overflow) + ASan host and mwcli:
#     - mwcli --continuation-suite quick (every segment in a child process: save stages, fault
#       injection, cancellation, truncated and missing inputs) and --state-info;
#     - tests/v46.test.js: exit codes, cancellation, process memory ledger (refusals, waiting
#       jobs, concurrent synchronous evaluations, restore that does not fit), cold Automatic.
#  2. ThreadSanitizer host: the ledger tests (concurrent evaluations, two background job
#     workers, restore) and ThreadSanitizer mwcli: training cancelled from a second thread.
# Any sanitizer report fails the pass.
# Usage: sh sanitize46.sh <source dir>     (EM_SAN_DIR=<dir> keeps and reuses the builds)
set -eu
src=$(CDPATH= cd -- "$1" && pwd)
if [ -n "${EM_SAN_DIR:-}" ]; then mkdir -p "$EM_SAN_DIR"; t=$(CDPATH= cd -- "$EM_SAN_DIR" && pwd); else t=$(mktemp -d); trap 'rm -rf "$t"' EXIT; fi
spec="$src/../validation/4.5/fixtures/icm-final8.spec.json"
echo "== build (UBSan+ASan, TSan)"
[ -x "$t/ub/mwcli" ] || sh "$src/tools/build_sanitized_host.sh" "$src" "$t/ub" undefined,float-cast-overflow,address
[ -x "$t/ts/mwcli" ] || sh "$src/tools/build_sanitized_host.sh" "$src" "$t/ts" thread
fail() { echo "$1"; exit 1; }
scan() { if grep -q 'runtime error\|ERROR: AddressSanitizer\|WARNING: ThreadSanitizer' "$@"; then grep -h 'runtime error\|ERROR: AddressSanitizer\|WARNING: ThreadSanitizer' -A12 "$@" | head -60; exit 1; fi; }
echo "== UBSan+ASan mwcli: continuation suite (quick)"
rm -rf "$t/suite"; ASAN_OPTIONS=detect_leaks=1 "$t/ub/mwcli" --continuation-suite "$spec" "$t/suite" quick 4 > "$t/suite.json" 2> "$t/suite.err" || { tail -30 "$t/suite.err"; fail 'continuation suite failed under UBSan+ASan'; }
scan "$t/suite.err" "$t/suite.json"
grep -o '"checksPassed":[0-9]*,"checksFailed":[0-9]*' "$t/suite.json"
echo "== UBSan+ASan host and CLI: tests/v46.test.js (exit codes, cancellation, ledger, cold Automatic)"
rm -f "$t/host-ub.err"; ASAN_OPTIONS=detect_leaks=0 EM_TEST_HOST_STDERR="$t/host-ub.err" EM_TEST_HOST="$t/ub/eightmax" EM_TEST_MWCLI="$t/ub/mwcli" node --test --test-concurrency=1 \
  --test-name-pattern='state-info|training exit codes|cancelled training|memory ledger|cold Automatic' "$src/tests/v46.test.js" > "$t/v46.log" 2>&1 || { grep -E '^not ok|error' -A10 "$t/v46.log" | head -80; exit 1; }
grep -E '^# (pass|fail|skipped)' "$t/v46.log"; scan "$t/v46.log" "$t/host-ub.err"
echo "== ThreadSanitizer host: process memory ledger under concurrent evaluations, job workers and restore"
rm -f "$t/host-ts.err"; TSAN_OPTIONS=halt_on_error=0 EM_TEST_HOST_STDERR="$t/host-ts.err" EM_TEST_HOST="$t/ts/eightmax" EM_TEST_MWCLI="$t/ts/mwcli" setarch -R node --test --test-concurrency=1 \
  --test-name-pattern='memory ledger' "$src/tests/v46.test.js" > "$t/v46ts.log" 2>&1 || { grep -E '^not ok|error' -A10 "$t/v46ts.log" | head -80; exit 1; }
grep -E '^# (pass|fail|skipped)' "$t/v46ts.log"; scan "$t/host-ts.err" "$t/v46ts.log"; echo "host TSan report file: $(wc -c < "$t/host-ts.err") bytes, no ThreadSanitizer warning"
echo "== ThreadSanitizer mwcli: training cancelled from a second thread"
"$t/ub/mwcli" "$spec" 30 4 "$t/a.state" 512 >/dev/null
EM_TRAIN_CANCEL_AFTER_MS=1500 TSAN_OPTIONS=halt_on_error=1 setarch -R "$t/ts/mwcli" "$spec" 5000000 4 "$t/c.state" 512 "$t/a.state" > "$t/c.json" 2> "$t/c.err" || { cat "$t/c.err" | head -40; fail 'TSan cancelled training failed'; }
scan "$t/c.err"; grep -q '"cancelled":true' "$t/c.json" || fail 'expected a cancelled run'
echo "tsan cancellation ok ($(grep -o '"iterations":[0-9]*' "$t/c.json"))"
echo "sanitize46: all passed"
