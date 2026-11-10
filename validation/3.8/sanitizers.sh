#!/bin/sh
# usage: run.sh <binary> <log>; exercises training (all estimators), restore, continuation, explorer and refusals
B=$1; L=$2; S=$(dirname $0)/..; : > $L; fail=0
step(){ "$@" >> $L 2>&1 || { echo "FAILED: $*" >> $L; fail=$((fail+1)); }; }
for d in "$S"/specs/*/; do u=60; case "$d" in *Heads*|*Three*) u=1500;; esac
  for v in '{}' '{"terminalBaseline":true}' '{"weighting":"dcfr"}' '{"regretMatching":"plus"}'; do
    python3 -c "import json,sys;s=json.load(open(sys.argv[1]));s.update(json.loads(sys.argv[2]));json.dump(s,open(sys.argv[3],'w'))" "${d}1.json" "$v" $S/san/sp.json
    step $B $S/san/sp.json $u 4 $S/san/a.state 512
    step $B $S/san/sp.json 2 4 $S/san/c.state 512 $S/san/a.state
    step $B --restore $S/san/sp.json $S/san/a.state 512
    for q in '{}' '{"path":[1]}' '{"path":[0,0]}' '{"rangeSeat":1,"offset":3,"limit":4}'; do echo "$q" > $S/san/q.json; step $B --node $S/san/sp.json $S/san/a.state $S/san/q.json; done
    echo '{"path":[7]}' > $S/san/q.json; $B --node $S/san/sp.json $S/san/a.state $S/san/q.json >> $L 2>&1 && { echo "UNEXPECTED ACCEPT" >> $L; fail=$((fail+1)); }
    $B --restore $S/san/sp.json $S/san/a.state 1 >> $L 2>&1
  done
done
echo "steps failed: $fail" >> $L; grep -c "ERROR: \(Address\|Thread\)Sanitizer\|runtime error\|WARNING: ThreadSanitizer" $L
