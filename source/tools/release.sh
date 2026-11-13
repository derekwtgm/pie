#!/bin/sh
set -eu
src=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
top=$(dirname -- "$src");out=${1:-"$top/release"}
mkdir -p "$out";out=$(CDPATH= cd -- "$out" && pwd);cd "$top"
version=$(cat "$src/VERSION");val="$top/validation/$version"
if [ "${2:-}" != --package-only ]; then
 node "$src/tools/build.js"
 sh "$src/native/build.sh" linux
 sh "$src/native/build.sh" windows
 sh "$src/native/build.sh" windows "$src/build/native.html" "$src/build/windows-check"
 for name in EightMax.exe mwcli.exe gpustress.exe; do
  cmp "$src/build/windows/$name" "$src/build/windows-check/$name"
  cp "$src/build/windows/$name" "$top/"
 done
 cp "$src/build/EightMax-Offline.html" "$top/"
 cp "$src/build/build-info.json" "$top/BUILD-INFO.json"
 export EM_TEST_HOST="$src/build/linux/eightmax" EM_TEST_MWCLI="$src/build/linux/mwcli"
 node "$src/tools/run_tests.js" "$val/regression-tests.json"
 # 3.7 restoration and continuation utilities are unchanged and still apply.
 python3 "$top/validation/3.7/restore-sizes.py" "$EM_TEST_HOST" "$val/native-restore-sizes.json"
 python3 "$top/validation/3.7/native-continuation.py" "$EM_TEST_HOST" "$EM_TEST_MWCLI" "$val/native-continuation.json"
 node "$src/tools/test_explorer_host.js" "$EM_TEST_HOST" "$val/explorer-host-linux.json"
 python3 "$src/tools/checkpoint_stress36.py" "$EM_TEST_HOST" "$val/checkpoint-sizes.json"
 for t in package_smoke mtt_ui_smoke checkpoint_ui_smoke; do node "$src/tools/$t.js" "$top" > "$val/$t.log"; done
 node "$src/tools/test_native_host.js" "$EM_TEST_HOST" "$src/build" "$val/native-host-linux.json"
 node "$src/tools/test_native_mw.js" "$EM_TEST_HOST" "$val/native-mw-linux.json"
fi
python3 "$src/tools/package36.py" "$top" "$out/EightMax-Windows-$version.zip"
