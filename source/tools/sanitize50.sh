#!/bin/sh
# EightMax 5.0 sanitizer pass for the 5.0 changes and the checkpoint paths.
#  UBSan (+float-cast-overflow) + ASan mwcli (built through build.sh, see build_sanitized_host.sh):
#    - mwcli --selftest47, --selftest48, --selftest49 (every step a child process: golden state, EMZ1
#      round trips, resume from EMZ1 incl. temp-directory fallback, Unicode/long temp folders, corrupted /
#      truncated / checksum-mismatched inputs, concurrent restores, 500+500 and 1000+1000 continuations);
#    - tests/v49.test.js and tests/v50.test.js against the sanitized CLI (scheduling on both training
#      paths with the CUDA test double, 4.9 checkpoints resumed, restore failure keeps the output);
#    - EMZ1 corruption fuzz (300 single-byte flips / truncations), every case refused or exact.
#  sched50 harness (one engine, consecutive short/long/short calls; scheduler, ScoreSchedule, test double)
#  under ASan+UBSan and under ThreadSanitizer (4 threads, Automatic and GPU Preferred).
# Any sanitizer report fails the pass.  Usage: sh sanitize50.sh <source dir> [work dir]
set -eu
src=$(CDPATH= cd -- "$1" && pwd)
t=${2:-$(mktemp -d)}; mkdir -p "$t"; t=$(CDPATH= cd -- "$t" && pwd)
scan() { if grep -q 'runtime error\|ERROR: AddressSanitizer\|WARNING: ThreadSanitizer\|ERROR: LeakSanitizer' "$@"; then grep -h 'runtime error\|ERROR: AddressSanitizer\|WARNING: ThreadSanitizer\|ERROR: LeakSanitizer' -A14 "$@" | head -80; exit 1; fi; }
fail() { echo "$1"; exit 1; }
echo "== build mwcli with UBSan+ASan"
[ -x "$t/ub/mwcli" ] || sh "$src/tools/build_sanitized_host.sh" "$src" "$t/ub" undefined,float-cast-overflow,address
"$t/ub/mwcli" --build-id
for v in 47 48 49; do
  echo "== UBSan+ASan: mwcli --selftest$v"
  rm -rf "$t/st$v"; ASAN_OPTIONS=detect_leaks=1 "$t/ub/mwcli" --selftest$v "$src/../validation/4.$((v - 40))/fixtures" "$t/st$v" > "$t/st$v.out" 2> "$t/st$v.err" || { tail -20 "$t/st$v.err"; fail "selftest$v failed under UBSan+ASan"; }
  scan "$t/st$v.err"; tail -1 "$t/st$v.out" | cut -c1-120
done
echo "== UBSan+ASan: EMZ1 corruption fuzz (300 cases)"
"$t/ub/mwcli" "$src/../validation/4.7/fixtures/river3.spec.json" 2000 2 "$t/f.state" 256 >/dev/null
"$t/ub/mwcli" --compress "$t/f.state" "$t/f.emz" >/dev/null
node -e '
const fs=require("fs"),cp=require("child_process"),[exe,src,state,dir,spec]=process.argv.slice(1),b=fs.readFileSync(src);let refused=0,exact=0,bad=0,seed=50;
const rnd=()=>{seed=(seed*1103515245+12345)>>>0;return seed/4294967296;};
for(let i=0;i<300;i++){const c=Buffer.from(b);if(i%3===2)fs.writeFileSync(dir+"/z.emz",c.subarray(0,Math.floor(rnd()*c.length)));else{const p=Math.floor(rnd()*c.length);c[p]^=1+Math.floor(rnd()*255);fs.writeFileSync(dir+"/z.emz",c);}
 try{fs.unlinkSync(dir+"/z.state")}catch{}
 const r=cp.spawnSync(exe,[spec,"1","1",dir+"/z.state","256",dir+"/z.emz"],{encoding:"utf8",env:{...process.env,ASAN_OPTIONS:"detect_leaks=1"}});
 if(/runtime error|AddressSanitizer|LeakSanitizer/.test(r.stderr)){console.log(r.stderr.slice(0,2000));process.exit(1);}
 if(r.status===0)exact++;else if((r.status===3||r.status===1)&&!fs.existsSync(dir+"/z.state"))refused++;else bad++;}   // 3 = unreadable input, 1 = refused input (for example a damaged magic number), nothing written
console.log("fuzz (train from a damaged EMZ1): refused",refused,"accepted",exact,"other",bad);process.exit(bad?1:0);' "$t/ub/mwcli" "$t/f.emz" "$t/f.state" "$t" "$src/../validation/4.7/fixtures/river3.spec.json" || fail 'EMZ1 fuzz failed'
echo "== UBSan+ASan CLI: tests/v49.test.js and tests/v50.test.js"
ASAN_OPTIONS=detect_leaks=0 EM_TEST_MWCLI="$t/ub/mwcli" node --test --test-reporter=tap --test-concurrency=1 "$src/tests/v49.test.js" "$src/tests/v50.test.js" > "$t/v4950.tap" 2>&1 || { grep -E '^not ok|rror' -A10 "$t/v4950.tap" | head -60; exit 1; }
grep -E '^# (pass|fail|skipped)' "$t/v4950.tap"; scan "$t/v4950.tap"
echo "== sched50 harness (consecutive training calls, scheduler) under ASan+UBSan and TSan"
n="$src/native"; g++ -std=c++20 -O1 -g -shared -fPIC "$src/tests/cuda_driver_fixture.cpp" -o "$t/libcuda.so.1"   # 5.0: -g: an optimised, unsymbolised test double showed its own static allocations as leaks after dlclose (no EightMax frame)
gcc -O1 -g -c "$n/json.c" -o "$t/json.o"
g++ -std=c++20 -O1 -g -fno-omit-frame-pointer -fsanitize=address,undefined,float-cast-overflow -fno-sanitize-recover=all -ffp-contract=off -I"$n" "$src/tests/sched50.cpp" "$n/mw.cpp" "$t/json.o" -lpthread -ldl -lz -o "$t/sched50-ub"
g++ -std=c++20 -O1 -g -fsanitize=thread -ffp-contract=off -I"$n" "$src/tests/sched50.cpp" "$n/mw.cpp" "$t/json.o" -lpthread -ldl -lz -o "$t/sched50-ts"
for mode in auto gpu; do
  node -e 'const fs=require("fs");const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));s.device=process.argv[2];fs.writeFileSync(process.argv[3],JSON.stringify(s))' "$src/tests/fixtures/device-turn.json" "$mode" "$t/seq-$mode.json"
  LD_LIBRARY_PATH="$t" EM_AUTO_MIN_SCORE_SECONDS=0.05 ASAN_OPTIONS=detect_leaks=1 "$t/sched50-ub" "$t/seq-$mode.json" 4 10,2000,10 > "$t/ub-$mode.out" 2> "$t/ub-$mode.err" || { tail -20 "$t/ub-$mode.err"; fail "sched50 ($mode) failed under ASan+UBSan"; }
  scan "$t/ub-$mode.err"
  LD_LIBRARY_PATH="$t" EM_AUTO_MIN_SCORE_SECONDS=0.05 TSAN_OPTIONS=halt_on_error=1 setarch -R "$t/sched50-ts" "$t/seq-$mode.json" 4 10,2000,10 > "$t/ts-$mode.out" 2> "$t/ts-$mode.err" || { tail -20 "$t/ts-$mode.err"; fail "sched50 ($mode) failed under TSan"; }
  scan "$t/ts-$mode.err"
  [ "$(tail -1 "$t/ub-$mode.out" | grep -o '"bodySha256":"[0-9a-f]*"')" = "$(tail -1 "$t/ts-$mode.out" | grep -o '"bodySha256":"[0-9a-f]*"')" ] || fail "sched50 ($mode): sanitized builds disagree"
  echo "  $mode: $(tail -1 "$t/ub-$mode.out" | grep -o '"bodySha256":"[0-9a-f]\{16\}')"
done
echo "sanitize50: all passed"
