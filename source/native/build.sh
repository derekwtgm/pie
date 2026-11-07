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
case "$version$build_id" in *[!0-9a-f.]*) echo 'Bad version or build id' >&2; exit 1 ;; esac
grep -q "EM.BUILD = Object.freeze({version:\"$version\",build:\"$build_id\"})" "$html" || { echo 'HTML and build-info.json disagree' >&2; exit 1; }
obj=$(mktemp -d)
trap 'rm -rf "$obj"' EXIT
printf '#define EM_VERSION "%s"\n#define EM_BUILD_ID "%s"\n' "$version" "$build_id" > "$obj/build_info.h"
python3 "$native_dir/gen_ui.py" "$html" "$obj/ui_html.h"
python3 "$native_dir/gen_cl.py" "$native_dir/gpu_kernels.cl" "$obj/gpu_cl_src.h"
cd "$native_dir"
if [ "$target" = linux ]; then
  cc=${CC:-gcc}
  "$cc" -O3 -march=x86-64 -DSFX=gen -I"$obj" -c solver.c -o "$obj/solver.o"
  "$cc" -O2 -include "$obj/build_info.h" -I"$obj" server.c gpu.c selftest.c cfg.c json.c "$obj/solver.o" -lpthread -lm -ldl -o "$dest/eightmax"
else
  if [ -n "${CC:-}" ]; then cc=$CC
  elif command -v x86_64-w64-mingw32-clang >/dev/null; then cc=x86_64-w64-mingw32-clang
  elif command -v x86_64-w64-mingw32-gcc >/dev/null; then cc=x86_64-w64-mingw32-gcc
  else echo 'Set CC to a 64-bit MinGW-w64 C compiler with winpthreads.' >&2; exit 1; fi
  "$cc" -O3 -march=x86-64 -mavx2 -mfma -DSFX=avx2 -I"$obj" -c solver.c -o "$obj/avx2.o"
  "$cc" -O3 -march=x86-64 -DSFX=sse -I"$obj" -c solver.c -o "$obj/sse.o"
  # -Wl,--no-insert-timestamp keeps the PE header deterministic for checksums.
  "$cc" -O2 -DEM_DUAL -include "$obj/build_info.h" -I"$obj" -static -pthread server.c gpu.c selftest.c cfg.c json.c "$obj/avx2.o" "$obj/sse.o" -lpsapi -lws2_32 -lshell32 -lwinmm -Wl,--no-insert-timestamp -s -o "$dest/EightMax.exe"
fi
