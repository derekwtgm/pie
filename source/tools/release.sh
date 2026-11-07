#!/bin/sh
# Build, verify and package an EightMax Windows release from this source tree.
# Usage: sh source/tools/release.sh [output-directory]
# Needs Node 22+, Python 3, a MinGW-w64 cross compiler (x86_64-w64-mingw32-gcc)
# and a native C compiler. Wine (optional) runs the Windows host checks on Linux;
# a Wine run is reported as such and is not a Windows validation.
set -eu
src=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
top=$(dirname -- "$src")
out=${1:-"$top/release"}
version=$(cat "$src/VERSION")
rel="$out/EightMax"
val="$rel/validation/$version"
log() { printf '%s\n' "$*"; }
if [ "${2:-}" = --package-only ]; then
  # Refresh documents in an already verified release and package it again.
  for f in README.txt CHANGELOG.md ROADMAP.md RELEASE-3.1.md RELEASE-3.0.md RELEASE-2.9.md RELEASE-2.8.md RELEASE-2.7.md ACCURACY-SUMMARY.md; do cp "$top/$f" "$rel/"; done
else
rm -rf "$rel" "$out/EightMax-Windows-$version.zip"
mkdir -p "$val"

log "== Building interface and native hosts ($version)"
node "$src/tools/build.js" "$src/build"
sh "$src/native/build.sh" windows "$src/build/native.html" "$src/build/windows"
sh "$src/native/build.sh" linux "$src/build/native.html" "$src/build/linux"
# Reproducibility: a second Windows build from the same source must be byte-identical.
sh "$src/native/build.sh" windows "$src/build/native.html" "$src/build/windows-check" >/dev/null
cmp "$src/build/windows/EightMax.exe" "$src/build/windows-check/EightMax.exe"
cmp "$src/build/windows/mwcli.exe" "$src/build/windows-check/mwcli.exe"
rm -rf "$src/build/windows-check"

log "== Assembling $rel"
cp "$src/build/windows/EightMax.exe" "$rel/EightMax.exe"
cp "$src/build/windows/mwcli.exe" "$rel/mwcli.exe"
cp "$src/build/EightMax-Offline.html" "$rel/EightMax-Offline.html"
cp "$src/build/build-info.json" "$rel/BUILD-INFO.json"
for f in README.txt CHANGELOG.md ROADMAP.md RELEASE-3.1.md RELEASE-3.0.md RELEASE-2.9.md RELEASE-2.8.md RELEASE-2.7.md ACCURACY-SUMMARY.md 'Run self-tests.bat' 'GPU self-test.bat' 'Compare processing modes.bat' 'Validate CUDA hardware.bat'; do cp "$top/$f" "$rel/"; done
mkdir -p "$rel/source" "$rel/.github"
( cd "$src" && tar --exclude=./build -cf - . ) | ( cd "$rel/source" && tar -xf - )
cp -R "$top/.github/." "$rel/.github/"
cp -R "$top/validation/." "$rel/validation/"
mkdir -p "$val"
# Keep the repository's copies of the entry points in step with the release.
cp "$rel/EightMax.exe" "$top/EightMax.exe"; cp "$rel/EightMax-Offline.html" "$top/EightMax-Offline.html"

log "== Regression tests (per-file limits; timeouts and skips counted separately)"
node "$src/tools/run_tests.js" "$val/regression-tests.json" > "$val/regression-tests.txt" 2>&1 || { tail -40 "$val/regression-tests.txt"; exit 1; }
tail -1 "$val/regression-tests.txt"

log "== Package and interface smoke tests"
node "$src/tools/package_smoke.js" "$rel" > "$val/package_smoke.log" 2>&1 || { tail -20 "$val/package_smoke.log"; exit 1; }
node "$src/tools/mtt_ui_smoke.js" "$rel" > "$val/mtt_ui.log" 2>&1 || { tail -20 "$val/mtt_ui.log"; exit 1; }
node "$src/tools/checkpoint_ui_smoke.js" "$rel" > "$val/checkpoint_ui.log" 2>&1 || { tail -20 "$val/checkpoint_ui.log"; exit 1; }

log "== Native host checks"
node "$src/tools/test_native_host.js" "$src/build/linux/eightmax" "$src/build" "$val/native-host-linux.json" > "$val/native-host-linux.log" 2>&1
if command -v wine >/dev/null 2>&1; then
  node "$src/tools/test_native_host.js" "$rel/EightMax.exe" "$src/build" "$val/native-host-wine.json" > "$val/native-host-wine.log" 2>&1
else
  log "Wine not installed: Windows host not run here" > "$val/native-host-wine.log"
fi

log "== Native multiway engine: protocol, browser integration, sanitizers, static analysis"
node "$src/tools/test_native_mw.js" "$src/build/linux/eightmax" "$val/native-mw-linux.json" > "$val/native-mw-linux.log" 2>&1 || { tail -20 "$val/native-mw-linux.log"; exit 1; }
node "$src/tools/native_ui_test.js" "$src/build/linux/eightmax" "$val/native-ui-linux.json" > "$val/native-ui-linux.log" 2>&1 || { tail -20 "$val/native-ui-linux.log"; exit 1; }
node "$src/tools/browser_recovery.js" "$rel" "$val/browser-recovery.json" > "$val/browser-recovery.log" 2>&1 || { tail -20 "$val/browser-recovery.log"; exit 1; }
if command -v wine >/dev/null 2>&1; then
  node "$src/tools/test_native_mw.js" "$rel/EightMax.exe" "$val/native-mw-wine.json" > "$val/native-mw-wine.log" 2>&1 || { tail -20 "$val/native-mw-wine.log"; exit 1; }
  node "$src/tools/native_ui_test.js" "$rel/EightMax.exe" "$val/native-ui-wine.json" > "$val/native-ui-wine.log" 2>&1 || { tail -20 "$val/native-ui-wine.log"; exit 1; }
fi
sh "$src/tools/sanitize29.sh" "$src" > "$val/sanitizers.log" 2>&1 || { tail -20 "$val/sanitizers.log"; exit 1; }
( x86_64-w64-mingw32-objdump -p "$rel/EightMax.exe" | grep 'DLL Name'; echo; x86_64-w64-mingw32-objdump -p "$rel/mwcli.exe" | grep 'DLL Name' ) > "$val/windows-dependencies.txt"
python3 -c '
import struct,sys
for f in sys.argv[1:]:
  d=open(f,"rb").read();pe=struct.unpack_from("<I",d,0x3c)[0];opt=pe+24;magic=struct.unpack_from("<H",d,opt)[0]
  dd=opt+(112 if magic==0x20b else 96);va,size=struct.unpack_from("<II",d,dd+8*4)
  print(f.split("/")[-1]+": "+("Authenticode certificate table present ("+str(size)+" bytes)" if size else "NOT digitally signed (no Authenticode certificate table)"))
' "$rel/EightMax.exe" "$rel/mwcli.exe" > "$val/signature.txt"

log "== Accuracy report and benchmarks"
node "$src/tools/accuracy_report.js" "$val" > "$val/accuracy.log" 2>&1

log "== Summary"
node -e '
const fs=require("fs"),p=require("path"),v=process.argv[1],ver=process.argv[2];
const j=f=>{try{return JSON.parse(fs.readFileSync(p.join(v,f),"utf8"));}catch(e){return null;}};
const reg=j("regression-tests.json").totals;
const lin=j("native-host-linux.json"),wine=j("native-host-wine.json"),acc=j("ACCURACY.json"),bench=j("benchmark.json");
const mwl=j("native-mw-linux.json"),mww=j("native-mw-wine.json"),uil=j("native-ui-linux.json"),uiw=j("native-ui-wine.json"),br=j("browser-recovery.json");
const out={version:ver,nativeMultiwayLinux:mwl&&mwl.passed,nativeMultiwayWine:mww?mww.passed:"not run",nativeUiLinux:uil&&uil.passed,nativeUiWine:uiw?uiw.passed:"not run",browserRecovery:br&&br.passed,
 sanitizers:"passed (see sanitizers.log)",cuda:"CUDA kernels compiled (NVRTC 12.9 PTX + sm_75/80/86/89 SASS) and run only through the CPU driver test double here; physical GPU execution not verified. Run Validate CUDA hardware.bat.",generated:new Date().toISOString(),windowsVerified:false,
 windowsNote:wine?"Cross-compiled; exercised under Wine, not Windows.":"Cross-compiled; not executed on Windows or Wine. Run Run self-tests.bat on Windows.",
 signed:false,regressionTests:reg,
 packageSmoke:"passed",interfaceSmoke:"passed",checkpointSmoke:"passed",
 nativeHostLinux:lin&&lin.passed,nativeHostWine:wine?wine.passed:"not run",
 accuracy:acc&&{exact3pRiver:acc.sections.multiwayExact.rows.map(r=>({iterations:r.iterations,maxGainBb:r.maxGainBb})),
  sampled3pRiver:acc.sections.sampled.rows.map(r=>({traversal:r.traversal,updates:r.updates,iterations:r.iterations,meanGainBb:r.mean,ci95:r.ci95}))},
 benchmark:"see bench31.json and large31.json"};
fs.writeFileSync(p.join(v,"VALIDATION-"+ver+".json"),JSON.stringify(out,null,1)+"\n");' "$val" "$version"

fi
node "$rel/source/tools/verify_build.js" "$rel"
log "== Checksums"
( cd "$rel" && find . -type f ! -name SHA256SUMS.txt | LC_ALL=C sort | sed 's|^\./||' | while IFS= read -r f; do sha256sum "$f"; done > SHA256SUMS.txt )
( cd "$rel" && sha256sum -c --quiet SHA256SUMS.txt )
( cd "$out" && rm -f "EightMax-Windows-$version.zip" && find EightMax -exec touch -h -d '2026-11-07 00:00:00' {} + && LC_ALL=C find EightMax -type f | LC_ALL=C sort | zip -X -q "EightMax-Windows-$version.zip" -@ )
sha256sum "$out/EightMax-Windows-$version.zip" | tee "$out/EightMax-Windows-$version.zip.sha256"
log "Release: $out/EightMax-Windows-$version.zip"
