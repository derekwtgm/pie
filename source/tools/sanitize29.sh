#!/bin/sh
# ThreadSanitizer and AddressSanitizer/UBSan runs of the native multiway engine
# (multithreaded training on a hashed flop tree and a dense 6-player river tree),
# plus cppcheck and strict compiler warnings. Usage: sh sanitize29.sh <source dir>
set -eu
src=$1; n="$src/native"; t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
node -e '
const S=process.argv[1],fs=require("fs");const E=require(S+"/tools/loadlib.js");for(const l of ["lib_runouts","lib_wide","lib_river","lib_river_ui"])require(S+"/web/"+l+".js");
fs.writeFileSync(process.argv[2]+"/flop.json",JSON.stringify(E.MultiwayGame({board:"Ks8d5h",common:12,stacks:[30,30,30,30],ranges:Array(4).fill("random"),streets:{flop:{bets:"50",raises:"",maxBets:1},turn:{bets:"75",raises:"",maxBets:1},river:{bets:"100",raises:"",maxBets:1}},privateMode:"sampled",abstraction:"exact",traversal:"full",batchDeals:16,evaluationDeals:128,fullTreeStates:250000}).nativeSpec()));
fs.writeFileSync(process.argv[2]+"/river6.json",JSON.stringify(E.MultiwayGame({...E.multiwaySpotConfig(E.multiwayExample(6,"River",8)),privateMode:"sampled",abstraction:"exact",engine:"native",batchDeals:16,evaluationDeals:128,updates:"enumerate",traversal:"full",fullTreeStates:250000}).nativeSpec()));
// 3.1 external sampling (spec protocol 4): 8-seat linked preflop, per-deal streams, and a 6-seat flop with all-ins.
fs.writeFileSync(process.argv[2]+"/es8.json",JSON.stringify(E.MultiwayGame({preflop:{mode:"linked",opens:"2,a",raises:"2.75x,a",maxBets:3,limps:true},board:"",dealt:8,common:0,stacks:[24.9,18,40,12,30,9,55,20],ranges:Array(8).fill("random"),privateMode:"sampled",evaluationDeals:128,abstraction:"exact",streets:{flop:{bets:"33,75",raises:"3x",maxBets:2},turn:{bets:"66",raises:"a",maxBets:2},river:{bets:"75,a",raises:"",maxBets:1}},batchDeals:16,actionStreams:"deal"}).nativeSpec()));
fs.writeFileSync(process.argv[2]+"/es6.json",JSON.stringify(E.MultiwayGame({board:"Td7c2h",dealt:8,common:1.5,stacks:[20,35,8,50,14,26],prior:[2.5,2.5,2.5,2.5,2.5,2.5],ranges:Array(6).fill("random"),privateMode:"sampled",abstraction:"exact",traversal:"external",evaluationDeals:128,batchDeals:4,icm:{payouts:[50,30,20],others:[15,22]},streets:{flop:{bets:"33,a",raises:"3x,a",maxBets:3},turn:{bets:"50,g",raises:"a",maxBets:2},river:{bets:"75,150",raises:"a",maxBets:2}}}).nativeSpec()));' "$src" "$t"
echo "== warnings (g++ -Wall -Wextra -Wshadow -Werror)"
# 3.3: '&& echo' does not stop a 'set -e' script when the compiler fails; fail explicitly.
g++ -std=c++20 -O2 -Wall -Wextra -Wshadow -Werror -ffp-contract=off -fsyntax-only -I"$n" "$n/mw.cpp" "$n/mwcli.cpp" || { echo "strict warnings FAILED"; exit 1; }
echo "no warnings"
echo "== ThreadSanitizer"
gcc -O1 -g -fsanitize=thread -c "$n/json.c" -o "$t/j.o"
g++ -std=c++20 -O1 -g -fsanitize=thread -ffp-contract=off -I"$n" "$n/mw.cpp" "$n/mwcli.cpp" "$t/j.o" -lpthread -ldl -o "$t/tsan"
for s in flop river6; do TSAN_OPTIONS=halt_on_error=1 setarch -R "$t/tsan" "$t/$s.json" 4 4 "$t/o" 4096; done
for s in es8 es6; do TSAN_OPTIONS=halt_on_error=1 setarch -R "$t/tsan" "$t/$s.json" 20 4 "$t/o" 4096; done
echo "== AddressSanitizer + UndefinedBehaviorSanitizer"
gcc -O1 -g -fsanitize=address,undefined -c "$n/json.c" -o "$t/ja.o"
g++ -std=c++20 -O1 -g -fsanitize=address,undefined -fno-sanitize-recover=all -ffp-contract=off -I"$n" "$n/mw.cpp" "$n/mwcli.cpp" "$t/ja.o" -lpthread -ldl -o "$t/asan"
for s in flop river6; do "$t/asan" "$t/$s.json" 4 4 "$t/$s.state" 4096; done
for s in es8 es6; do ASAN_OPTIONS=detect_leaks=0 "$t/asan" "$t/$s.json" 20 4 "$t/$s.state" 4096; ASAN_OPTIONS=detect_leaks=0 "$t/asan" "$t/$s.json" 5 2 "$t/o3" 4096 "$t/$s.state"; done
"$t/asan" "$t/flop.json" 2 2 "$t/o2" 4096 "$t/flop.state"
echo "== cppcheck"
if command -v cppcheck >/dev/null; then
  out=$(cppcheck --enable=warning,portability,performance --std=c++20 --language=c++ -q "$n/mw.cpp" "$n/mwcli.cpp" 2>&1); if [ -n "$out" ]; then echo "$out"; exit 1; fi; echo "cppcheck: no findings"
else echo "cppcheck not installed"; fi
echo "sanitizers passed"
