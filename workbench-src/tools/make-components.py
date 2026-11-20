"""0.30+ developer utility (0.35: + EightMaxInput.exe, EightMaxTestTable.exe): generate desktop/COMPONENT-VERSIONS.json from EVIDENCE, never from hand-typed flags.
Inputs: the shipped binaries (SHA-256), evidence/build-evidence.json (written by tools/build-windows-binaries.sh) and
evidence/windows-ci-runs.json (facts read from Windows CI job logs and from the target PC's own reports).
A status is true only when an evidence record names the EXACT SHA-256 of the shipped file."""
import hashlib, json, re
from pathlib import Path
root = Path(__file__).resolve().parent.parent
v = re.search(r"const VERSION='([0-9.]+)'", (root / 'src/engine.js').read_text()).group(1)
sha = lambda p: hashlib.sha256((root / p).read_bytes()).hexdigest()
build = json.loads((root / 'evidence/build-evidence.json').read_text())
ci = json.loads((root / 'evidence/windows-ci-runs.json').read_text())
BIN = {'desktop/bin/EightMaxWorkbench.exe': ['desktop/DesktopHost.cs', 'desktop/CaptureService.cs', 'desktop/InputBroker.cs'], 'desktop/bin/EightMaxInput.exe': ['desktop/input/Driver.cs', 'desktop/input/Motion.cs', 'desktop/input/Platform.cs', 'desktop/input/Program.cs', 'desktop/input/Safety.cs', 'desktop/input/Uia.cs'], 'desktop/bin/EightMaxTestTable.exe': ['desktop/testtable/EightMaxTestTable.cs'], 'desktop/bin/EightMaxCapture.exe': ['desktop/capture/EightMaxCapture.cs', 'desktop/CaptureService.cs'],
       'desktop/bin/EightMaxWgc.exe': ['desktop/wgc/Program.cs', 'desktop/wgc/SelfTest.cs', 'desktop/wgc/PngWriter.cs'], 'native/mwcli.exe': ['native/source (EightMax 5.1, unchanged)'], 'runtime/node/node.exe': ['official nodejs.org win-x64 v22.23.5']}
comps = {}
for b, sources in BIN.items():
    h = sha(b); be = build['outputs'].get(b)
    built = bool(be and be['sha256'] == h)
    runs = [r for r in ci['runs'] if r['executables'].get(b) == h]
    target = [t for t in ci.get('targetHardware', []) if t['executables'].get(b) == h]
    status = {'builtFromSourceForThisRelease': built, 'crossCompiled': bool(built and be.get('crossCompiled')), 'executedOnWindows': bool(runs or target),
              'validatedInWindowsCI': bool(runs), 'testedOnTargetHardware': bool(target)}
    status['notVerified'] = [k for k, val in status.items() if not val and k not in ('builtFromSourceForThisRelease', 'crossCompiled')]
    comps[b] = {'sha256': h, 'sources': sources, 'status': status,
                'compiler': be['compiler'] if built else ('not rebuilt (unchanged file)' if b in ('native/mwcli.exe', 'runtime/node/node.exe') else 'UNKNOWN - no build evidence for this hash'),
                'evidence': [{'kind': 'windows-ci', 'run': r['runId'], 'release': r['release'], 'runner': r['runner'], 'observed': r['observed'].get(b)} for r in runs] + [{'kind': 'target-pc', 'release': t['release'], 'machine': t['machine'], 'observed': t['observed'].get(b)} for t in target]}
doc = {'format': 'eightmax-component-versions', 'version': 3, 'appVersion': v, 'generatedBy': 'tools/make-components.py from evidence/build-evidence.json and evidence/windows-ci-runs.json',
       'statusMeaning': {'builtFromSourceForThisRelease': 'compiled from the shipped source for this release (hash recorded at build time)', 'crossCompiled': 'compiled on Linux for Windows; compiling is not running',
                         'executedOnWindows': 'this exact file (same SHA-256) ran on some Windows machine', 'validatedInWindowsCI': 'this exact file passed the Windows CI acceptance run listed in evidence', 'testedOnTargetHardware': 'this exact file ran on the user\'s PC', 'notVerified': 'statuses for which no evidence exists'},
       'components': comps}
(root / 'desktop/COMPONENT-VERSIONS.json').write_text(json.dumps(doc, indent=2) + '\n')
print('components written for', v); [print(' ', k, {s: x for s, x in c['status'].items() if s != 'notVerified'}) for k, c in comps.items()]
