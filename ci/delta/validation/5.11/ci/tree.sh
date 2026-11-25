#!/bin/bash
# Rebuilds the 5.11 working tree in <dest>/EightMax: the delivered 5.10 archive with ci/delta laid over it.
set -euo pipefail
dest=$1; here=$(cd "$(dirname "$0")/.." && pwd); mkdir -p "$dest"
( cd "$dest" && unzip -q "$here/release-5.10/EightMax-Windows-5.10.zip" )
cp -r "$here/ci/delta/." "$dest/EightMax/"
while read -r f; do [ -n "$f" ] && rm -f "$dest/EightMax/$f"; done < "$here/ci/delete.txt"
rm -f "$dest/EightMax/SHA256SUMS.txt"
if [ -d "${2:-/nonexistent}" ]; then   # built programs of the build job
  cp "$2"/*.exe "$2"/EightMax-Offline.html "$dest/EightMax/"; cp "$2"/BUILD-INFO.json "$dest/EightMax/BUILD-INFO.json"
  mkdir -p "$dest/EightMax/build/linux" "$dest/EightMax/validation/5.11/linux-bin"; cp "$2"/linux/* "$dest/EightMax/build/linux/"; cp "$2"/linux/* "$dest/EightMax/validation/5.11/linux-bin/"
  cp "$2"/native.html "$2"/build-info.json "$dest/EightMax/build/"; cp "$2"/EightMax-Offline.html "$dest/EightMax/build/"
  chmod +x "$dest/EightMax/build/linux/"* "$dest/EightMax"/validation/*/linux-bin/* 2>/dev/null || true
fi
echo "tree: $dest/EightMax"
