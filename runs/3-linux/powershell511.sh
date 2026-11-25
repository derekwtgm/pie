#!/bin/bash
# EightMax 5.11: the Windows validation script executed by PowerShell 7 on Linux against the LINUX programs.
# Usage: bash validation/5.11/powershell510.sh <release root> <pwsh> <work dir>
# A copy of the release tree is made in which mwcli.exe, EightMax.exe and gpustress.exe are the Linux programs (Linux
# does not care about the extension), and validate_windows511.ps1 is run on it, first -Focused, then in full. This
# executes the script's own logic - the plan, every section that does not need Windows itself or an NVIDIA GPU, the
# comparisons, the report - with a real PowerShell. It is NOT a run on Windows and not a run with Windows PowerShell 5.1.
# Also: every .ps1 of the release through the PowerShell parser.
set -u
root=$(cd "$1" && pwd); pw=$2; work=$3; out="$root/validation/5.11/powershell"; rm -rf "$work" "$out"; mkdir -p "$work/root" "$work/focused" "$work/full" "$out"
"$pw" -NoProfile -Command '$PSVersionTable.PSVersion.ToString() + " on " + [System.Runtime.InteropServices.RuntimeInformation]::OSDescription' > "$out/powershell-version.txt" 2>&1; cat "$out/powershell-version.txt"
: > "$out/parser.txt"
for f in "$root"/source/tools/*.ps1; do
  "$pw" -NoProfile -Command "\$e = \$null; \$t = \$null; [void][System.Management.Automation.Language.Parser]::ParseFile('$f', [ref]\$t, [ref]\$e); '$(basename "$f"): ' + \$e.Count + ' parse errors, ' + \$t.Count + ' tokens'; if (\$e.Count) { \$e | ForEach-Object { '  ' + \$_.ToString() }; exit 1 }" >> "$out/parser.txt" 2>&1 || echo "PARSE FAILURE $(basename "$f")" >> "$out/parser.txt"
done
cat "$out/parser.txt"
cp -rs "$root"/. "$work/root/" 2>/dev/null; rm -rf "$work/root/build"
for pair in mwcli.exe:mwcli EightMax.exe:eightmax gpustress.exe:gpustress; do rm -f "$work/root/${pair%%:*}"; cp "$root/build/linux/${pair##*:}" "$work/root/${pair%%:*}"; done
rm -f "$work/root/BUILD-INFO.json"; cp "$root/BUILD-INFO.json" "$work/root/BUILD-INFO.json"
( cd "$work/focused" && "$pw" -NoProfile -File "$work/root/source/tools/validate_windows511.ps1" -Focused -SkipIntegrity -Root "$work/root" -OutDir "$work/focused" > "$out/focused.stdout" 2>&1; echo "focused exit $?" | tee "$out/focused.exit" )
cp "$work/focused"/Windows-focused-validation-5.11.json "$work/focused"/Windows-focused-validation-5.11.txt "$out/" 2>/dev/null
( cd "$work/full" && "$pw" -NoProfile -File "$work/root/source/tools/validate_windows511.ps1" -SkipIntegrity -Root "$work/root" -OutDir "$work/full" > "$out/full.stdout" 2>&1; echo "full exit $?" | tee "$out/full.exit" )
cp "$work/full"/Windows-validation-5.11.json "$work/full"/Windows-validation-5.11.txt "$out/" 2>/dev/null
tail -4 "$out/focused.stdout"; tail -12 "$out/full.stdout"
