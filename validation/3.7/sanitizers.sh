#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd);cd "$root"
work=$(mktemp -d);trap 'rm -rf "$work"' EXIT
cat > "$work/cc" <<'CC'
#!/bin/sh
case " $* " in *" -c quickjs/"*|*" -c solver.c "*) exec "${EM_PLAIN_CC:-gcc}" "$@";; esac
exec gcc -fsanitize=address,undefined -fno-omit-frame-pointer -fno-sanitize-recover=all "$@"
CC
cat > "$work/cxx" <<'CXX'
#!/bin/sh
exec g++ -fsanitize=address,undefined -fno-omit-frame-pointer -fno-sanitize-recover=all -no-pie "$@"
CXX
chmod +x "$work/cc" "$work/cxx"
node source/tools/build.js "$work/ui"
CC="$work/cc" CXX="$work/cxx" sh source/native/build.sh linux "$work/ui/native.html" "$work/bin"
export EM_TEST_HOST="$work/bin/eightmax" EM_TEST_MWCLI="$work/bin/mwcli"
node --test --test-reporter=tap --test-name-pattern='host handles|block SHA|valid hashes|HTTP streaming|disk reserve|cancel and concurrent|ingress timeout|cold scan|process death' source/tests/v36.test.js
node --test --test-reporter=tap source/tests/v33.test.js

node --test --test-reporter=tap source/tests/v37.test.js
