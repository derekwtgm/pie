#!/bin/sh
# EightMax 4.0 validation, Linux (Ubuntu 24.04, Node 22, GCC 13, MinGW-w64 GCC 13 posix, Wine 9).
# usage: sh validation/4.0/reproduce.sh <mwcli built from the 3.9 source> [out-dir]
set -eu
top=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd); src="$top/source"; old=$1; out=${2:-"$top/validation/4.0"}
w=$(mktemp -d); trap 'rm -rf "$w"' EXIT
sh "$src/tools/release.sh" "$w/release"                     # builds, full suite, host utilities, package
gcc -O2 "$src/tools/peak_rss.c" -o "$w/peak_rss"
sh "$src/tools/sanitize40.sh" "$src" > "$out/sanitizers.log" 2>&1
node "$src/tools/bench40.js" "$old" "$src/build/linux/mwcli" "$w/peak_rss" "$out/bench40.json"
node "$src/tools/threads40.js" "$src/build/linux/mwcli" "$w/peak_rss" "$out/threads40.json"
node "$src/tools/convergence40.js" "$src/build/linux/mwcli" "$out/convergence40.json"
