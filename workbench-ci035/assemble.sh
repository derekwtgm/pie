#!/bin/sh
# Assemble the 0.35.0 tree: the verified 0.33.0 release ZIP + the overlay in workbench-src/ (files added or replaced in 0.35).
# Usage: sh workbench-ci035/assemble.sh BASE_ZIP OUT_DIR
set -eu
base=$1; out=$2; here=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
rm -rf "$out"; mkdir -p "$out"; tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
unzip -q "$base" -d "$tmp"; cp -a "$tmp/EightMax-Test-Workbench/." "$out/"
cp -a "$here/workbench-src/." "$out/"
