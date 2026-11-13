#!/bin/sh
# EightMax 4.1: build the complete Linux desktop host (server.c, ev_jobs.h,
# checkpoint store, solver, multiway engine) and mwcli with sanitizers, using
# the normal build.sh so the binaries are the same code as a release build.
# 4.0 sanitized only mwcli and a stress tool, so the HTTP job API (where the
# 1e300 -> int64 conversion lived) never ran under UBSan.
# Usage: sh build_sanitized_host.sh <source dir> <output dir> [sanitizers]
#   sanitizers default: undefined,float-cast-overflow,address
#   (GCC does not include float-cast-overflow in -fsanitize=undefined.)
set -eu
src=$(CDPATH= cd -- "$1" && pwd); mkdir -p "$2"; out=$(CDPATH= cd -- "$2" && pwd)
san=${3:-undefined,float-cast-overflow,address}
w=$(mktemp -d); trap 'rm -rf "$w"' EXIT
# 4.6: the vendored QuickJS 2021-03-27 sources (checkpoint verifier) contain formally undefined
# but platform-benign operations (memcpy from NULL with length 0, left shifts into the sign bit)
# that UBSan aborts on once a checkpoint is restored through the host. Third-party code is
# compiled WITHOUT the UBSan checks (AddressSanitizer / ThreadSanitizer still apply to it);
# EightMax's own code keeps every check. The one QuickJS header function compiled into
# EightMax code (JS_NewFloat64, float-cast-overflow) was fixed in quickjs.h instead.
ub_less=$(printf '%s' "$san" | tr ',' '\n' | grep -v -e '^undefined$' -e '^float-cast-overflow$' | paste -sd, -)
for pair in "cc gcc" "cxx g++"; do set -- $pair
  cat > "$w/$1" <<WRAP
#!/bin/sh
case "\$*" in *quickjs/*) [ -n "$ub_less" ] && exec $2 -g -fno-omit-frame-pointer -fsanitize=$ub_less "\$@"; exec $2 -g -fno-omit-frame-pointer "\$@" ;; esac
exec $2 -g -fno-omit-frame-pointer -fsanitize=$san -fno-sanitize-recover=all "\$@"
WRAP
  chmod +x "$w/$1"
done
node "$src/tools/build.js" >/dev/null
CC="$w/cc" CXX="$w/cxx" sh "$src/native/build.sh" linux "$src/build/native.html" "$out" 2>"$w/log" || { tail -30 "$w/log"; exit 1; }
echo "sanitized ($san) host: $out/eightmax, $out/mwcli"
