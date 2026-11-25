#!/bin/bash
# Builds every source tree listed in ci/targets (one per line: "<name> zip <archive>" or "<name> dir <path>").
set -euo pipefail
root=$PWD; mkdir -p out; cp toolchain.txt out/ || true
while read -r name kind where; do
  [ -n "$name" ] || continue
  w=$(mktemp -d)
  if [ "$kind" = zip ]; then (cd "$w" && unzip -q "$root/$where" 'EightMax/source/*' 'EightMax/.github/*' && mv EightMax/source EightMax/.github . )
  else cp -r "$root/$where/source" "$w/source"; cp -r "$root/$where/.github" "$w/.github"; fi
  cd "$w"
  node source/tools/build.js build
  CC=x86_64-w64-mingw32-gcc-posix CXX=x86_64-w64-mingw32-g++-posix sh source/native/build.sh windows "$PWD/build/native.html" "$PWD/build/windows" 2> "$root/out/$name-windows-build.log"
  sh source/native/build.sh linux "$PWD/build/native.html" "$PWD/build/linux" 2> "$root/out/$name-linux-build.log"
  mkdir -p "$root/out/$name/linux"
  cp build/windows/*.exe build/EightMax-Offline.html build/build-info.json "$root/out/$name/"
  cp build/linux/* "$root/out/$name/linux/"
  (cd "$root/out/$name" && sha256sum *.exe EightMax-Offline.html linux/* | tee SHA256.txt)
  cd "$root"
done < ci/targets
