#!/bin/sh
# EightMax 5.1 sanitizer pass. Runs the whole 5.0 pass (tools/sanitize50.sh: selftests 47-49, EMZ1 fuzz,
# v49/v50 tests, sched50 harness under ASan+UBSan and TSan), then the 5.1 additions:
#  - tests/v51.test.js against the UBSan+ASan CLI (route reuse with the CUDA test double in every cost
#    environment, schedule resume/cancel/memory-stop, 4.9/5.0 checkpoints, refusals);
#  - sched50 harness, one engine and consecutive calls (route measurements persist on the engine), in GPU
#    Preferred and Hybrid with the crossover cost model (both routes inside one job), ASan+UBSan and TSan;
#  - the adaptive batch schedule with parallel batches (six-player weighted, batchDeals 64, start 4,
#    doubleEvery 8, 4 threads) under ASan+UBSan and TSan, state bodies equal across the two builds.
# Any sanitizer report fails the pass.  Usage: sh sanitize51.sh <source dir> [work dir]
set -eu
src=$(CDPATH= cd -- "$1" && pwd)
t=${2:-$(mktemp -d)}; mkdir -p "$t"; t=$(CDPATH= cd -- "$t" && pwd)
scan() { if grep -q 'runtime error\|ERROR: AddressSanitizer\|WARNING: ThreadSanitizer\|ERROR: LeakSanitizer' "$@"; then grep -h 'runtime error\|ERROR: AddressSanitizer\|WARNING: ThreadSanitizer\|ERROR: LeakSanitizer' -A14 "$@" | head -80; exit 1; fi; }
fail() { echo "$1"; exit 1; }
sh "$src/tools/sanitize50.sh" "$src" "$t"
echo "== UBSan+ASan CLI: tests/v51.test.js"
ASAN_OPTIONS=detect_leaks=0 EM_TEST_MWCLI="$t/ub/mwcli" node --test --test-reporter=tap --test-concurrency=1 "$src/tests/v51.test.js" > "$t/v51.tap" 2>&1 || { grep -E '^not ok|rror' -A10 "$t/v51.tap" | head -60; exit 1; }
grep -E '^# (pass|fail|skipped)' "$t/v51.tap"; scan "$t/v51.tap"
echo "== route reuse across consecutive calls, crossover cost model (gpu, hybrid) under ASan+UBSan and TSan"
for mode in gpu hybrid; do
  node -e 'const fs=require("fs");const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));s.device=process.argv[2];fs.writeFileSync(process.argv[3],JSON.stringify(s))' "$src/tests/fixtures/device-turn.json" "$mode" "$t/x-$mode.json"
  for b in ub ts; do
    pre=""; [ $b = ts ] && pre="setarch -R"
    LD_LIBRARY_PATH="$t" EM_TEST_CPU_SCORE_NS=20000 EM_FIXTURE_LAUNCH_US=2860 ASAN_OPTIONS=detect_leaks=1 TSAN_OPTIONS=halt_on_error=1 $pre "$t/sched50-$b" "$t/x-$mode.json" 4 20,60,20 > "$t/x-$b-$mode.out" 2> "$t/x-$b-$mode.err" || { tail -20 "$t/x-$b-$mode.err"; fail "route reuse ($mode, $b) failed"; }
    scan "$t/x-$b-$mode.err"
  done
  [ "$(tail -1 "$t/x-ub-$mode.out" | grep -o '"bodySha256":"[0-9a-f]*"')" = "$(tail -1 "$t/x-ts-$mode.out" | grep -o '"bodySha256":"[0-9a-f]*"')" ] || fail "route reuse ($mode): sanitized builds disagree"
  echo "  $mode: $(tail -1 "$t/x-ub-$mode.out" | grep -o '"bodySha256":"[0-9a-f]\{16\}') reuses $(grep -o '"calibrationReusesThisCall":[0-9]*' "$t/x-ub-$mode.out" | tr '\n' ' ')"
done
echo "== adaptive batch schedule with parallel batches under ASan+UBSan and TSan"
node -e 'const fs=require("fs");const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));Object.assign(s,{batchDeals:64,actionStreams:"deal",batchSchedule:{start:4,doubleEvery:8}});fs.writeFileSync(process.argv[2],JSON.stringify(s))' "$src/tests/fixtures/es-six-weighted.json" "$t/warm.json"
for b in ub ts; do
  pre=""; [ $b = ts ] && pre="setarch -R"
  ASAN_OPTIONS=detect_leaks=1 TSAN_OPTIONS=halt_on_error=1 $pre "$t/sched50-$b" "$t/warm.json" 4 9,30,7 > "$t/w-$b.out" 2> "$t/w-$b.err" || { tail -20 "$t/w-$b.err"; fail "schedule ($b) failed"; }
  scan "$t/w-$b.err"
done
[ "$(tail -1 "$t/w-ub.out" | grep -o '"bodySha256":"[0-9a-f]*"')" = "$(tail -1 "$t/w-ts.out" | grep -o '"bodySha256":"[0-9a-f]*"')" ] || fail "schedule: sanitized builds disagree"
echo "  schedule: $(tail -1 "$t/w-ub.out" | grep -o '"bodySha256":"[0-9a-f]\{16\}') threads used $(grep -o '"trainingThreadsUsed":[0-9]*\|"threadsUsed":[0-9]*' "$t/w-ub.out" | sort -u | tr '\n' ' ')"
echo "sanitize51: all passed"
