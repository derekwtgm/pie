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
for pair in "cc gcc" "cxx g++"; do set -- $pair
  printf '#!/bin/sh\nexec %s -g -fno-omit-frame-pointer -fsanitize=%s -fno-sanitize-recover=all "$@"\n' "$2" "$san" > "$w/$1"; chmod +x "$w/$1"
done
node "$src/tools/build.js" >/dev/null
CC="$w/cc" CXX="$w/cxx" sh "$src/native/build.sh" linux "$src/build/native.html" "$out" 2>"$w/log" || { tail -30 "$w/log"; exit 1; }
echo "sanitized ($san) host: $out/eightmax, $out/mwcli"
