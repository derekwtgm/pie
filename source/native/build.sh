#!/bin/sh
# Usage: sh build.sh linux|windows [native.html] [output-directory]
set -eu
case "${1:-}" in linux|windows) target=$1 ;; *) echo 'Choose linux or windows' >&2; exit 2 ;; esac
native_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
html=${2:-"$native_dir/../build/native.html"}
dest=${3:-"$native_dir/../build/$target"}
mkdir -p "$dest"
dest=$(CDPATH= cd -- "$dest" && pwd)
if [ ! -f "$html" ]; then echo 'Build the UI first with node source/tools/build.js.' >&2; exit 1; fi
info="$(dirname -- "$html")/build-info.json"
if [ ! -f "$info" ]; then echo 'build-info.json from build.js is missing next to the HTML.' >&2; exit 1; fi
version=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$info")
build_id=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["build"])' "$info")
actual=$(node -e 'console.log(require(process.argv[1])(process.argv[2]).build)' "$native_dir/../tools/fingerprint.js" "$native_dir/..")
[ "$actual" = "$build_id" ] || { echo "Rebuild the interface after changing source or compiler flags." >&2; exit 1; }
case "$version$build_id" in *[!0-9a-f.]*) echo 'Bad version or build id' >&2; exit 1 ;; esac
grep -q "EM.BUILD = Object.freeze({version:\"$version\",build:\"$build_id\"})" "$html" || { echo 'HTML and build-info.json disagree' >&2; exit 1; }
obj=$(mktemp -d)
trap 'rm -rf "$obj"' EXIT
printf '#define EM_VERSION "%s"\n#define EM_BUILD_ID "%s"\n' "$version" "$build_id" > "$obj/build_info.h"
python3 "$native_dir/gen_ui.py" "$html" "$obj/ui_html.h"
python3 "$native_dir/gen_cl.py" "$native_dir/gpu_kernels.cl" "$obj/gpu_cl_src.h"
cd "$native_dir"
for lib in cards eval pots icm information checkpoint runouts wide river; do cat "../web/lib_$lib.js"; done > "$obj/verify.js"
cat checkpoint_verify.js >> "$obj/verify.js"
python3 gen_ui.py "$obj/verify.js" "$obj/checkpoint_bundle.h"
build_verifier() {
  for f in quickjs libunicode libregexp cutils libbf; do
    "$cc" -O2 -D_GNU_SOURCE -DCONFIG_BIGNUM -DCONFIG_VERSION='"2021-03-27"' -c "quickjs/$f.c" -o "$obj/q_$f.o"
  done
  "$cc" -O2 -I"$obj" -c checkpoint_verify.c -o "$obj/q_verify.o"
}
if [ "$target" = linux ]; then
  cc=${CC:-gcc}
  "$cc" -O3 -march=x86-64 -DSFX=gen -I"$obj" -c solver.c -o "$obj/solver.o"
  cxx=${CXX:-g++}
  # Multiway engine: C++20, strict IEEE arithmetic (no fast-math, no FMA contraction) for JS parity.
  "$cxx" -std=c++20 -O2 -march=x86-64 -ffp-contract=off -I. -c mw.cpp -o "$obj/mw.o"
  build_verifier
  for f in server gpu selftest cfg json; do "$cc" -O2 -include "$obj/build_info.h" -I"$obj" -c $f.c -o "$obj/$f.o"; done
  "$cxx" "$obj"/q_*.o "$obj/server.o" "$obj/gpu.o" "$obj/selftest.o" "$obj/cfg.o" "$obj/json.o" "$obj/solver.o" "$obj/mw.o" -lpthread -lm -ldl -lcrypto -o "$dest/eightmax"
  "$cxx" -std=c++20 -O2 -march=x86-64 -ffp-contract=off -I. -include "$obj/build_info.h" mwcli.cpp "$obj/mw.o" "$obj/json.o" -lpthread -ldl -o "$dest/mwcli"
else
  # 3.1 uses std::thread: GCC MinGW-w64 needs the winpthreads (-posix) variant.
  if [ -n "${CC:-}" ]; then cc=$CC
  elif command -v x86_64-w64-mingw32-clang >/dev/null; then cc=x86_64-w64-mingw32-clang
  elif command -v x86_64-w64-mingw32-gcc-posix >/dev/null; then cc=x86_64-w64-mingw32-gcc-posix
  elif command -v x86_64-w64-mingw32-gcc >/dev/null; then cc=x86_64-w64-mingw32-gcc
  else echo 'Set CC to a 64-bit MinGW-w64 C compiler with winpthreads.' >&2; exit 1; fi
  "$cc" -O3 -march=x86-64 -mavx2 -mfma -DSFX=avx2 -I"$obj" -c solver.c -o "$obj/avx2.o"
  "$cc" -O3 -march=x86-64 -DSFX=sse -I"$obj" -c solver.c -o "$obj/sse.o"
  # -Wl,--no-insert-timestamp keeps the PE header deterministic for checksums.
  cxx=${CXX:-$(printf '%s' "$cc" | sed 's/gcc\(-posix\)\{0,1\}$/g++\1/; s/clang$/clang++/')}
  "$cxx" -std=c++20 -O2 -march=x86-64 -ffp-contract=off -I. -c mw.cpp -o "$obj/mw.o"
  build_verifier
  for f in server gpu selftest cfg json; do "$cc" -O2 -DEM_DUAL -include "$obj/build_info.h" -I"$obj" -c $f.c -o "$obj/$f.o"; done
  "$cxx" -static -pthread "$obj"/q_*.o "$obj/server.o" "$obj/gpu.o" "$obj/selftest.o" "$obj/cfg.o" "$obj/json.o" "$obj/avx2.o" "$obj/sse.o" "$obj/mw.o" -lbcrypt -lpsapi -lws2_32 -lshell32 -lwinmm -Wl,--no-insert-timestamp -s -o "$dest/EightMax.exe"
  "$cxx" -std=c++20 -O2 -march=x86-64 -ffp-contract=off -static -pthread -I. -include "$obj/build_info.h" mwcli.cpp "$obj/mw.o" "$obj/json.o" -Wl,--no-insert-timestamp -s -o "$dest/mwcli.exe"
fi
