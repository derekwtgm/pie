#!/bin/sh
# EightMax 3.3 sanitizer and static-analysis pass. Runs the 3.2/2.9 checks
# (sanitize29.sh: strict warnings, ThreadSanitizer, ASan+UBSan, cppcheck), then
#   - TSan and ASan+UBSan on the new 3.3 paths: external-sampling DCFR, native
#     Detailed/Compact hand groups (flop and preflop), checkpoint resume of both;
#   - the complete 3.3 regression file (tests/v33.test.js) against an
#     ASan+UBSan mwcli (EM_TEST_MWCLI), so every malformed-input, import and
#     fault case runs under the sanitizers;
#   - cppcheck on the 3.3 headers through mw.cpp and on cfg.c.
# Usage: sh sanitize33.sh <source dir>
set -eu
src=$(CDPATH= cd -- "$1" && pwd); n="$src/native"; t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
sh "$src/tools/sanitize29.sh" "$src"
node -e '
const S=process.argv[1],fs=require("fs");const E=require(S+"/tools/loadlib.js");for(const l of ["lib_runouts","lib_wide","lib_river"])require(S+"/web/"+l+".js");
const six={board:"Td7c2h",dealt:8,common:1.5,stacks:[20,35,8,50,14,26],prior:[2.5,2.5,2.5,2.5,2.5,2.5],folded:[1,2.5],ranges:Array(6).fill("22+,A2s+,K9s+,QTs+,JTs,ATo+,KJo+:0.6"),privateMode:"sampled",traversal:"external",evaluationDeals:128,streets:{flop:{bets:"33,a",raises:"3x",maxBets:2},turn:{bets:"50",raises:"a",maxBets:1},river:{bets:"75",raises:"",maxBets:1}},batchDeals:4,actionStreams:"deal"};
const pf8={preflop:{mode:"linked",opens:"2",raises:"3x,a",maxBets:3},board:"",dealt:8,common:0,stacks:Array(8).fill(25),ranges:Array(8).fill("random"),privateMode:"sampled",evaluationDeals:128,bets:"50",raises:"",maxBets:1,traversal:"external",batchDeals:8,actionStreams:"deal"};
fs.writeFileSync(process.argv[2]+"/dcfr6.json",JSON.stringify(E.MultiwayGame({...six,abstraction:"exact",weighting:"dcfr"}).nativeSpec()));
fs.writeFileSync(process.argv[2]+"/group6.json",JSON.stringify(E.MultiwayGame({...six,abstraction:"detailed",weighting:"dcfr"}).nativeSpec()));
fs.writeFileSync(process.argv[2]+"/group8.json",JSON.stringify(E.MultiwayGame({...pf8,abstraction:"compact"}).nativeSpec()));' "$src" "$t"
echo "== 3.3 ThreadSanitizer (DCFR, grouped keys)"
gcc -O1 -g -fsanitize=thread -c "$n/json.c" -o "$t/j.o"
g++ -std=c++20 -O1 -g -fsanitize=thread -ffp-contract=off -I"$n" "$n/mw.cpp" "$n/mwcli.cpp" "$t/j.o" -lpthread -ldl -o "$t/tsan"
for s in dcfr6 group6 group8; do TSAN_OPTIONS=halt_on_error=1 setarch -R "$t/tsan" "$t/$s.json" 30 4 "$t/o" 4096 >/dev/null; echo "tsan $s ok"; done
echo "== 3.3 AddressSanitizer + UndefinedBehaviorSanitizer (train, export, resume)"
gcc -O1 -g -fsanitize=address,undefined -c "$n/json.c" -o "$t/ja.o"
g++ -std=c++20 -O1 -g -fsanitize=address,undefined -fno-sanitize-recover=all -ffp-contract=off -I"$n" "$n/mw.cpp" "$n/mwcli.cpp" "$t/ja.o" -lpthread -ldl -o "$t/asan"
for s in dcfr6 group6 group8; do
  "$t/asan" "$t/$s.json" 30 4 "$t/$s.state" 4096 >/dev/null
  "$t/asan" "$t/$s.json" 10 2 "$t/$s.2" 4096 "$t/$s.state" >/dev/null
  "$t/asan" "$t/$s.json" 400 2 "$t/$s.3" 1 >/dev/null   # memory stop path
  echo "asan $s ok"
done
echo "== tests/v33.test.js against the ASan+UBSan mwcli"
EM_TEST_MWCLI="$t/asan" node --test "$src/tests/v33.test.js" > "$t/v33.log" 2>&1 || { tail -40 "$t/v33.log"; exit 1; }
grep -E '^# (pass|fail|skipped)' "$t/v33.log"
echo "== cppcheck (3.3 headers via mw.cpp; cfg.c)"
# cppcheck exits 0 on these findings; treat any output as a failure.
out=$(cppcheck --enable=warning,portability,performance --std=c++20 --language=c++ -q -I"$n" "$n/mw.cpp" "$n/mwcli.cpp" 2>&1); if [ -n "$out" ]; then echo "$out"; exit 1; fi; echo "cppcheck mw: no findings"
out=$(cppcheck --enable=warning,portability --std=c11 --language=c -q -I"$n" "$n/cfg.c" 2>&1); if [ -n "$out" ]; then echo "$out"; exit 1; fi; echo "cppcheck cfg.c: no findings"
gcc -std=c11 -O2 -Wall -Wextra -Werror -fsyntax-only -I"$n" "$n/cfg.c" || { echo "cfg.c warnings FAILED"; exit 1; }; echo "cfg.c: no warnings"
echo "sanitizers 3.3 passed"
