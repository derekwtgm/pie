#!/bin/sh
# EightMax 4.7 sanitizer pass for the 4.7 changes (tools/sanitize45.sh and sanitize46.sh cover the inherited ones).
#  1. UBSan (+float-cast-overflow) + ASan mwcli and host:
#     - tests/v47.test.js (own-hand enumeration, verify, compare, monitor, analytics, dashboard
#       monitor against the host, EMZ1 compressed checkpoints, independent best response);
#     - mwcli --selftest47 (every step a child process);
#     - EMZ1 corruption fuzz: 300 random single-byte flips / truncations of a compressed
#       checkpoint, each decompressed (must fail cleanly or reproduce the exact bytes).
#  2. ThreadSanitizer: own-hand enumeration training with parallel batch walkers (4 threads),
#     --monitor with its elapsed-time watchdog thread raising the stop flag, and the dashboard
#     monitor test against a TSan host.
# Any sanitizer report fails the pass.
# Usage: sh sanitize47.sh <source dir>     (EM_SAN_DIR=<dir> keeps and reuses the builds)
set -eu
src=$(CDPATH= cd -- "$1" && pwd)
if [ -n "${EM_SAN_DIR:-}" ]; then mkdir -p "$EM_SAN_DIR"; t=$(CDPATH= cd -- "$EM_SAN_DIR" && pwd); else t=$(mktemp -d); trap 'rm -rf "$t"' EXIT; fi
fx="$src/../validation/4.7/fixtures"
echo "== build (UBSan+ASan, TSan)"
[ -x "$t/ub/mwcli" ] || sh "$src/tools/build_sanitized_host.sh" "$src" "$t/ub" undefined,float-cast-overflow,address
[ -x "$t/ts/mwcli" ] || sh "$src/tools/build_sanitized_host.sh" "$src" "$t/ts" thread
fail() { echo "$1"; exit 1; }
scan() { if grep -q 'runtime error\|ERROR: AddressSanitizer\|WARNING: ThreadSanitizer\|ERROR: LeakSanitizer' "$@"; then grep -h 'runtime error\|ERROR: AddressSanitizer\|WARNING: ThreadSanitizer\|ERROR: LeakSanitizer' -A14 "$@" | head -80; exit 1; fi; }
echo "== UBSan+ASan: mwcli --selftest47"
rm -rf "$t/st47"; ASAN_OPTIONS=detect_leaks=1 "$t/ub/mwcli" --selftest47 "$fx" "$t/st47" > "$t/st47.json" 2> "$t/st47.err" || { tail -30 "$t/st47.err"; fail 'selftest47 failed under UBSan+ASan'; }
scan "$t/st47.err" "$t/st47/selftest47.json"; grep -o '"checksPassed":[0-9]*,"checksFailed":[0-9]*' "$t/st47.json"
echo "== UBSan+ASan: EMZ1 corruption fuzz (300 cases)"
"$t/ub/mwcli" "$fx/river3.spec.json" 2000 2 "$t/f.state" 256 >/dev/null
"$t/ub/mwcli" --compress "$t/f.state" "$t/f.emz" >/dev/null
node -e '
const fs=require("fs"),cp=require("child_process"),[exe,src,state,dir]=process.argv.slice(1),b=fs.readFileSync(src),want=fs.readFileSync(state);let ok=0,refused=0,bad=0,seed=12345;
const rnd=()=>{seed=(seed*1103515245+12345)>>>0;return seed/4294967296;};
for(let i=0;i<300;i++){const c=Buffer.from(b);if(i%3===2){fs.writeFileSync(dir+"/z.emz",c.subarray(0,Math.floor(rnd()*c.length)));}else{const p=Math.floor(rnd()*c.length);c[p]^=1+Math.floor(rnd()*255);fs.writeFileSync(dir+"/z.emz",c);}
 try{fs.unlinkSync(dir+"/z.state")}catch{}
 const r=cp.spawnSync(exe,["--decompress",dir+"/z.emz",dir+"/z.state"],{encoding:"utf8",env:{...process.env,ASAN_OPTIONS:"detect_leaks=1"}});
 if(/runtime error|AddressSanitizer|LeakSanitizer/.test(r.stderr)){console.log(r.stderr.slice(0,2000));process.exit(1);}
 if(r.status===0){if(fs.readFileSync(dir+"/z.state").equals(want))ok++;else bad++;}else if(r.status===1&&!fs.existsSync(dir+"/z.state"))refused++;else bad++;}
console.log("fuzz: refused",refused,"decoded exactly",ok,"wrong",bad);process.exit(bad?1:0);' "$t/ub/mwcli" "$t/f.emz" "$t/f.state" "$t" || fail 'EMZ1 fuzz failed'
echo "== UBSan+ASan host and CLI: tests/v47.test.js"
rm -f "$t/host-ub.err"; ASAN_OPTIONS=detect_leaks=0 EM_TEST_HOST_STDERR="$t/host-ub.err" EM_TEST_HOST="$t/ub/eightmax" EM_TEST_MWCLI="$t/ub/mwcli" node --test --test-concurrency=1 "$src/tests/v47.test.js" > "$t/v47.log" 2>&1 || { grep -E '^not ok|rror' -A10 "$t/v47.log" | head -80; exit 1; }
grep -E '^# (pass|fail|skipped)' "$t/v47.log"; scan "$t/v47.log" "$t/host-ub.err"
echo "== ThreadSanitizer: own-hand enumeration, parallel batch walkers"
TSAN_OPTIONS=halt_on_error=1 setarch -R "$t/ts/mwcli" "$src/../validation/4.5/fixtures/icm-final8.spec.json" 20 1 "$t/x.state" 512 >/dev/null 2>"$t/x.err" || { cat "$t/x.err" | head; fail 'tsan smoke failed'; }
node -e '
const E=require(process.argv[1]+"/tools/loadlib");for(const l of ["lib_runouts","lib_wide","lib_river"])require(process.argv[1]+"/web/"+l);
require("fs").writeFileSync(process.argv[2],JSON.stringify(E.MultiwayGame({privateMode:"sampled",abstraction:"exact",traversal:"external",preflop:{mode:"shove"},dealt:4,common:0,board:"",stacks:[12,7,20,4],ranges:["AsAh,7c2d:0.5,KdQd","KsKh:0.75,8c3d,9h9d","QsQh,6d5d,AdJc","JsJh:0.5,9s8s,Tc9c"],icm:{payouts:[50,30,20]},batchDeals:16,actionStreams:"deal",ownHandEnumeration:true,terminalBaseline:true,privateSeed:3}).nativeSpec()));' "$src" "$t/own16.json"
TSAN_OPTIONS=halt_on_error=1 setarch -R "$t/ts/mwcli" "$t/own16.json" 400 4 "$t/own.state" 256 > "$t/own.json" 2> "$t/own.err" || { head -40 "$t/own.err"; fail 'TSan own-hand training failed'; }
scan "$t/own.err"; grep -o '"threads":[0-9]*' "$t/own.json"
echo "== ThreadSanitizer: --monitor with the elapsed-time watchdog"
rm -rf "$t/mon"; TSAN_OPTIONS=halt_on_error=1 setarch -R "$t/ts/mwcli" --monitor "$fx/river3.spec.json" "$t/mon" updates=10000000 first=10000000 seconds=1 eval=none threads=4 > "$t/mon.json" 2> "$t/mon.err" || { head -40 "$t/mon.err"; fail 'TSan monitor failed'; }
scan "$t/mon.err"; grep -o '"stop":"[^"]*"' "$t/mon.json"
echo "== ThreadSanitizer host: dashboard live monitor"
rm -f "$t/host-ts.err"; TSAN_OPTIONS=halt_on_error=0 EM_TEST_HOST_STDERR="$t/host-ts.err" EM_TEST_HOST="$t/ts/eightmax" EM_TEST_MWCLI="$t/ub/mwcli" setarch -R node --test --test-concurrency=1 --test-name-pattern='dashboard live' "$src/tests/v47.test.js" > "$t/v47ts.log" 2>&1 || { grep -E '^not ok|rror' -A10 "$t/v47ts.log" | head -60; exit 1; }
grep -E '^# (pass|fail|skipped)' "$t/v47ts.log"; scan "$t/host-ts.err" "$t/v47ts.log"
echo "sanitize47: all passed"
