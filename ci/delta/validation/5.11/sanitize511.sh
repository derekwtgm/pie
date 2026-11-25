#!/bin/bash
# EightMax 5.11 sanitizer runs: the code 5.11 added or touched (the counter-based streams in the deal sampler and the
# three traversal call sites, the counter audit, spec and header parsing, the limits) and the code it runs through.
# Usage: bash validation/5.11/sanitize511.sh <release root> <work dir>
#  1. AddressSanitizer + UndefinedBehaviorSanitizer + float-cast-overflow build of the host and CLI (the 5.3 builder);
#     then mwcli --selftest511 (all sections), --selftest510 (training, checkpoint, limits) and the 5.11 regression file.
#  2. ThreadSanitizer build of the CLI: mwcli --selftest511 streams (the counter audit records from three threads);
#     frozen-batch philox64 trainings on four threads (exact cards, Compact and Detailed groups, ICM, rbes); the
#     states of the instrumented program against the release program on one thread.
#  3. Leak check: the ASan CLI with detect_leaks=1 on a philox64 training, a refused setting, a refused checkpoint.
set -u
root=$(cd "$1" && pwd); work=$2; out="$root/validation/5.11/sanitizers"; rm -rf "$work" "$out"; mkdir -p "$work" "$out"
T="$root/source/tests"; cli="$root/build/linux/mwcli"
bash "$root/validation/5.3/sanitizers/build-final.sh" "$root/source" "$root/build" "$work/asan" > "$out/build-asan-ubsan.log" 2>&1; echo "asan build exit $?" | tee "$out/build-asan-ubsan.exit"
export ASAN_OPTIONS=detect_leaks=0:abort_on_error=0 UBSAN_OPTIONS=print_stacktrace=1
"$work/asan/mwcli" --selftest511 "$root/studies" "$work/st511-asan" all > "$out/selftest511-asan.stdout" 2> "$out/selftest511-asan.stderr"; echo "asan selftest511 exit $?" | tee "$out/selftest511-asan.exit"
cp "$work/st511-asan/selftest511.json" "$out/selftest511-asan.json" 2>/dev/null
for sec in training checkpoint limits; do "$work/asan/mwcli" --selftest510 "$root/studies" "$work/st510-asan-$sec" $sec > "$out/selftest510-$sec-asan.stdout" 2> "$out/selftest510-$sec-asan.stderr"; echo "asan selftest510 $sec exit $?" | tee "$out/selftest510-$sec-asan.exit"; done
EM_TEST_MWCLI="$work/asan/mwcli" node --test --test-concurrency=1 --test-reporter=tap --test-name-pattern='5.11 streams: an independent|5.11 the 5.10 streams|5.11 philox64|5.11 checkpoints|5.11 limits|5.11 studies' "$T/v511.test.js" > "$out/v511-asan-ubsan.tap" 2>&1
echo "asan tests (5.11 file: independent implementation, 5.10 streams untouched, determinism, checkpoints, limits, studies) exit $?" | tee "$out/v511-asan-ubsan.exit"; tail -9 "$out/v511-asan-ubsan.tap"
grep -c -E 'ERROR: AddressSanitizer|runtime error:' "$out"/*.tap "$out"/*.stderr "$out"/*.stdout 2>/dev/null | tee "$out/sanitizer-report-counts.txt"
# 2
obj="$work/tsan"; mkdir -p "$obj"; printf '#define EM_VERSION "5.11"\n#define EM_BUILD_ID "tsan"\n' > "$obj/build_info.h"
( cd "$root/source/native" && g++ -std=c++20 -O1 -g1 -fsanitize=thread -fno-omit-frame-pointer -march=x86-64 -ffp-contract=off -I. -c mw.cpp -o "$obj/mw.o" && gcc -O1 -fsanitize=thread -c json.c -o "$obj/json.o" &&
  g++ -std=c++20 -O1 -g1 -fsanitize=thread -march=x86-64 -ffp-contract=off -I. -include "$obj/build_info.h" mwcli.cpp "$obj/mw.o" "$obj/json.o" -lpthread -ldl -lz -o "$obj/mwcli" ) > "$out/build-tsan.log" 2>&1; echo "tsan build exit $?" | tee "$out/build-tsan.exit"
export TSAN_OPTIONS=halt_on_error=0 EIGHTMAX_THREAD_CHOICE=fixed
B='{"trainingStreams":"philox64","batchDeals":16,"actionStreams":"deal"}'; RB='{"trainingStreams":"philox64","estimator":"rbes","batchDeals":16,"actionStreams":"deal"}'
node "$root/source/tools/games510.js" spec rg-turn3 "$work/t3.json" 7 "$B"; node "$root/source/tools/games510.js" spec rg-flop3c "$work/f3c.json" 7 "$B"; node "$root/source/tools/games510.js" spec rg-icm3-river "$work/icm.json" 7 "$B"; node "$root/source/tools/games510.js" spec rg-turn3 "$work/t3rb.json" 7 "$RB"
python3 - "$root" "$work" <<'PY'
import json, sys, pathlib
root, work = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
s = json.loads((root / 'source/studies/flop3-kings-detailed.emfix.json').read_text(encoding='utf-8-sig'))['variants'][0]['nativeSpec']
(work / 'det.json').write_text(json.dumps({**s, 'trainingStreams': 'philox64', 'batchDeals': 64, 'actionStreams': 'deal'}))
PY
W="$root/validation/5.11/windows/streams"
{ "$obj/mwcli" --selftest511 "$root/studies" "$work/st511-tsan" streams > "$out/selftest511-streams-tsan.stdout" 2> "$work/st511-tsan.stderr"; echo "selftest511 streams (counter audit from three threads) exit $?"; grep -c 'WARNING: ThreadSanitizer' "$work/st511-tsan.stderr" | sed 's/^/  ThreadSanitizer warnings in that run: /'; } > "$out/tsan.log" 2>&1
runs="t3:$work/t3.json:200 f3c:$work/f3c.json:120 icm:$work/icm.json:200 t3rb:$work/t3rb.json:120 det:$work/det.json:40 w:$W/flop3-kings-philox64-batch64.spec.json:20"
{ for r in $runs; do IFS=: read -r name spec upd <<< "$r"; "$obj/mwcli" "$spec" "$upd" 4 "$work/$name.tsan.state" 256 > /dev/null; echo "$name: frozen-batch philox64 training on four threads exit $?"; done; } >> "$out/tsan.log" 2>&1
cat "$work/st511-tsan.stderr" | grep -A30 'WARNING: ThreadSanitizer' | head -80 >> "$out/tsan.log"
echo "ThreadSanitizer warnings: $(( $(grep -c 'WARNING: ThreadSanitizer' "$out/tsan.log") + $(grep -c 'WARNING: ThreadSanitizer' "$work/st511-tsan.stderr") ))" | tee "$out/tsan-summary.txt"; grep -E 'exit [0-9]+' "$out/tsan.log" | tee -a "$out/tsan-summary.txt"
same=0; total=0
for r in $runs; do IFS=: read -r name spec upd <<< "$r"; "$cli" "$spec" "$upd" 1 "$work/$name.release.state" 256 > /dev/null; total=$((total+1)); if cmp -s "$work/$name.tsan.state" "$work/$name.release.state"; then same=$((same+1)); else echo "DIFFERENT: $name" | tee -a "$out/tsan-summary.txt"; fi; done
echo "states of the instrumented program on four threads equal the release program on one thread: $same of $total" | tee -a "$out/tsan-summary.txt"
unset EIGHTMAX_THREAD_CHOICE
# 3
node "$root/source/tools/games510.js" spec rg-turn4 "$work/l.json" 7 '{"trainingStreams":"philox64"}'; node "$root/source/tools/games510.js" spec rg-turn4 "$work/lp.json" 7; node "$root/source/tools/games510.js" spec rg-turn4 "$work/lbad.json" 7 '{"trainingStreams":"philox64","trainingSeed":"XYZ"}'
L() { ASAN_OPTIONS=detect_leaks=1 "$work/asan/mwcli" "$@"; }
L "$work/l.json" 4000 1 "$work/l.state" 128 > /dev/null 2> "$out/leak-train.log"; echo "$?" > "$out/leak-train.exit"
L "$work/lbad.json" 100 1 "$work/lbad.state" 128 > /dev/null 2> "$out/leak-refused-setting.log"; echo "$?" > "$out/leak-refused-setting.exit"
L "$work/lp.json" 100 1 "$work/lp.state" 128 "$work/l.state" > /dev/null 2> "$out/leak-refused-checkpoint.log"; echo "$?" > "$out/leak-refused-checkpoint.exit"
echo "leak check: philox64 training exit $(cat "$out/leak-train.exit") (0 expected), refused setting exit $(cat "$out/leak-refused-setting.exit") (1 expected), refused checkpoint exit $(cat "$out/leak-refused-checkpoint.exit") (1 expected); LeakSanitizer reports: $(cat "$out"/leak-*.log | grep -c 'ERROR: LeakSanitizer')" | tee "$out/leak-summary.txt"
{ cat "$out"/build-asan-ubsan.exit "$out"/selftest511-asan.exit "$out"/selftest510-*-asan.exit "$out"/v511-asan-ubsan.exit "$out"/build-tsan.exit
  grep -E '^# (tests|pass|fail|skipped)' "$out/v511-asan-ubsan.tap" | tr '\n' ' '; echo "(v511-asan-ubsan)"
  echo "sanitizer reports (ERROR: AddressSanitizer / runtime error) in all outputs: $(awk -F: '{s+=$NF} END{print s+0}' "$out/sanitizer-report-counts.txt")"
  cat "$out/tsan-summary.txt" "$out/leak-summary.txt"; } > "$out/summary.txt"
cat "$out/summary.txt"
