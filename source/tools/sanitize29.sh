#!/bin/sh
# ThreadSanitizer and AddressSanitizer/UBSan runs of the native multiway engine
# (multithreaded training on a hashed flop tree and a dense 6-player river tree),
# plus cppcheck and strict compiler warnings. Usage: sh sanitize29.sh <source dir>
set -eu
src=$1; n="$src/native"; t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
node -e '
const S=process.argv[1],fs=require("fs");const E=require(S+"/tools/loadlib.js");for(const l of ["lib_runouts","lib_wide","lib_river","lib_river_ui"])require(S+"/web/"+l+".js");
fs.writeFileSync(process.argv[2]+"/flop.json",JSON.stringify(E.MultiwayGame({board:"Ks8d5h",common:12,stacks:[30,30,30,30],ranges:Array(4).fill("random"),streets:{flop:{bets:"50",raises:"",maxBets:1},turn:{bets:"75",raises:"",maxBets:1},river:{bets:"100",raises:"",maxBets:1}},privateMode:"sampled",abstraction:"exact",traversal:"full",batchDeals:16,evaluationDeals:128,fullTreeStates:250000}).nativeSpec()));
fs.writeFileSync(process.argv[2]+"/river6.json",JSON.stringify(E.MultiwayGame({...E.multiwaySpotConfig(E.multiwayExample(6,"River",8)),privateMode:"sampled",abstraction:"exact",engine:"native",batchDeals:16,evaluationDeals:128,updates:"enumerate"}).nativeSpec()));' "$src" "$t"
echo "== warnings (g++ -Wall -Wextra -Wshadow -Werror)"
g++ -std=c++20 -O2 -Wall -Wextra -Wshadow -Werror -ffp-contract=off -fsyntax-only -I"$n" "$n/mw.cpp" "$n/mwcli.cpp" && echo "no warnings"
echo "== ThreadSanitizer"
gcc -O1 -g -fsanitize=thread -c "$n/json.c" -o "$t/j.o"
g++ -std=c++20 -O1 -g -fsanitize=thread -ffp-contract=off -I"$n" "$n/mw.cpp" "$n/mwcli.cpp" "$t/j.o" -lpthread -o "$t/tsan"
for s in flop river6; do TSAN_OPTIONS=halt_on_error=1 setarch -R "$t/tsan" "$t/$s.json" 4 4 "$t/o" 4096; done
echo "== AddressSanitizer + UndefinedBehaviorSanitizer"
gcc -O1 -g -fsanitize=address,undefined -c "$n/json.c" -o "$t/ja.o"
g++ -std=c++20 -O1 -g -fsanitize=address,undefined -fno-sanitize-recover=all -ffp-contract=off -I"$n" "$n/mw.cpp" "$n/mwcli.cpp" "$t/ja.o" -lpthread -o "$t/asan"
for s in flop river6; do "$t/asan" "$t/$s.json" 4 4 "$t/$s.state" 4096; done
"$t/asan" "$t/flop.json" 2 2 "$t/o2" 4096 "$t/flop.state"
echo "== cppcheck"
if command -v cppcheck >/dev/null; then cppcheck --enable=warning,portability,performance --std=c++20 --language=c++ -q --error-exitcode=1 "$n/mw.cpp" "$n/mwcli.cpp" && echo "cppcheck: no findings"; else echo "cppcheck not installed"; fi
echo "sanitizers passed"
