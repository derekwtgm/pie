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
obj=$(mktemp -d)
trap 'rm -rf "$obj"' EXIT
python3 "$native_dir/gen_ui.py" "$html" "$obj/ui_html.h"
python3 "$native_dir/gen_cl.py" "$native_dir/gpu_kernels.cl" "$obj/gpu_cl_src.h"
cd "$native_dir"
if [ "$target" = linux ]; then
  cc=${CC:-gcc}
  "$cc" -O3 -march=native -ffast-math -DSFX=gen -I"$obj" -c solver.c -o "$obj/solver.o"
  "$cc" -O2 -I"$obj" server.c gpu.c selftest.c cfg.c json.c "$obj/solver.o" -lpthread -lm -ldl -o "$dest/eightmax"
else
  if [ -n "${CC:-}" ]; then cc=$CC
  elif command -v x86_64-w64-mingw32-clang >/dev/null; then cc=x86_64-w64-mingw32-clang
  elif command -v x86_64-w64-mingw32-gcc >/dev/null; then cc=x86_64-w64-mingw32-gcc
  else echo 'Set CC to a 64-bit MinGW-w64 C compiler with winpthreads.' >&2; exit 1; fi
  "$cc" -O3 -march=x86-64-v3 -ffast-math -DSFX=avx2 -I"$obj" -c solver.c -o "$obj/avx2.o"
  "$cc" -O3 -march=x86-64-v2 -ffast-math -DSFX=sse -I"$obj" -c solver.c -o "$obj/sse.o"
  "$cc" -O2 -DEM_DUAL -I"$obj" -static -pthread server.c gpu.c selftest.c cfg.c json.c "$obj/avx2.o" "$obj/sse.o" -lws2_32 -lshell32 -lwinmm -o "$dest/EightMax.exe"
fi
