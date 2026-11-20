'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), os = require('node:os');
const root = path.join(__dirname, '..'), read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const hasMcs = (() => { try { cp.execFileSync('mcs', ['--version'], { stdio: 'pipe' }); return true; } catch (e) { return false; } })();

test('0.28 acceptance orchestrator: structure, honest reporting, loopback-only HTTP, no downloads (NOT executed here: no Windows PowerShell)', () => {
  const t = read('windows/Test-Release.ps1');
  assert.match(t, /\$ErrorActionPreference='Stop'/); assert.match(t, /nothing here has run on Windows yet/);
  for (const c of ['release-integrity', 'powershell-parse-all-scripts', 'dashboard-version-markers', 'executable-versions', 'capture/', 'wgc/', 'desktop/', 'no-orphaned-processes', 'hardware-check', "'install'", "'rollback'", "'uninstall'", 'Collect-TestResults.ps1']) assert.ok(t.includes(c), c);
  assert.match(t, /'skip'/, 'skipped checks are reported as skipped, never as passed'); assert.match(t, /'not-run'/, 'a criterion whose checks did not run is never PASS');
  const web = [...t.matchAll(/Invoke-WebRequest -Uri \(([^)]+)\)/g)].map((m) => m[1]); assert.ok(web.every((u) => /\$sess\.origin/.test(u)), 'only the private loopback host session is contacted');
  assert.ok(!/DownloadFile|curl|Start-BitsTransfer|Invoke-RestMethod/i.test(t), 'no downloads'); assert.ok(!/python|npm /i.test(t)); assert.ok(!/&\s*.*node\.exe/i.test(t), 'node.exe is only version-listed, never run');
  let depth = 0, braces = 0; for (const ch of t.replace(/'[^']*'/g, "''")) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === '{') braces++; if (ch === '}') braces--; } assert.equal(depth, 0, 'balanced parentheses'); assert.equal(braces, 0, 'balanced braces');
  assert.match(read('RUN-RELEASE-ACCEPTANCE.cmd'), /windows\\Test-Release\.ps1/);
  assert.ok(!/python|node\.exe|npm /i.test(read('START-DESKTOP.cmd') + read('INSTALL-WINDOWS.cmd')), 'launcher and installer need no Python or Node.js');
});
test('every Windows script agrees on version 0.35.0 through Common.ps1, and the C# host matches', () => {
  assert.match(read('windows/Common.ps1'), /\$WorkbenchVersion = '0\.35\.0'/);
  for (const f of ['windows/Install-Workbench.ps1', 'windows/Start-Workbench.ps1', 'windows/Test-Desktop.ps1', 'windows/Test-Capture.ps1', 'windows/Test-Release.ps1', 'windows/Test-Wgc.ps1', 'windows/Collect-TestResults.ps1']) { const s = read(f); assert.ok(/\$WorkbenchVersion|New-EmReport/.test(s), f + ' takes its version from Common.ps1'); assert.ok(!/appVersion='0\.2[4-7]\.0'/.test(s), f + ' has no stale hard-coded version'); }
  assert.match(read('desktop/DesktopHost.cs'), /Version="0\.35\.0"/); assert.match(read('desktop/capture/EightMaxCapture.cs'), /ToolVersion = "0\.35\.0"/);
});
test('rebuilt Windows executables carry 0.35.0 and are x64 PE32+; their sources compile with Mono at C# 5 (cross-compilation only: NOT Windows execution)', { skip: hasMcs ? false : 'Mono mcs not installed' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em28-')), A = '/usr/lib/mono/4.8-api', refs = ['-nostdlib', ...['mscorlib', 'System', 'System.Core', 'System.Web.Extensions', 'System.Windows.Forms', 'System.Drawing'].map((n) => '-r:' + A + '/' + n + '.dll')];
  try {
    cp.execFileSync('mcs', ['-langversion:5', '-main:EightMax.Workbench.DesktopHost', '-platform:x64', '-target:winexe', '-optimize+', ...refs, '-out:' + path.join(tmp, 'EightMaxWorkbench.exe'), path.join(root, 'desktop/DesktopHost.cs'), path.join(root, 'desktop/CaptureService.cs'), path.join(root, 'desktop/InputBroker.cs')], { stdio: 'pipe' });
    cp.execFileSync('mcs', ['-langversion:5', '-platform:x64', '-target:exe', '-optimize+', ...refs, '-out:' + path.join(tmp, 'EightMaxCapture.exe'), path.join(root, 'desktop/capture/EightMaxCapture.cs'), path.join(root, 'desktop/CaptureService.cs')], { stdio: 'pipe' });
    for (const name of ['EightMaxWorkbench.exe', 'EightMaxCapture.exe']) {
      const fresh = fs.readFileSync(path.join(tmp, name)), shipped = fs.readFileSync(path.join(root, 'desktop/bin', name));
      // 0.35 (changed): since 0.33 the shipped executables are compiled ON WINDOWS with the .NET Framework compiler, so a Mono build
      // cannot be byte- or size-equal; the Windows build evidence (evidence/build-evidence.json) records their hashes instead.
      assert.ok(fresh.length > 10000, name + ': the shipped source compiles');
      assert.ok(shipped.toString('utf16le').includes('0.35.0'), name + ' embeds 0.35.0');
      const e = shipped.readUInt32LE(0x3c); assert.equal(shipped.readUInt16LE(e + 4), 0x8664); assert.equal(shipped.readUInt16LE(e + 24), 0x20b);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
test('capture catalogue and host agree: Windows Graphics Capture exists only as an installed helper and is manual-only', () => {
  const CM = require('../src/capture-manager.js'); assert.equal(CM.CATALOG['windows-graphics-capture'].implemented, true); assert.equal(CM.CATALOG['windows-graphics-capture'].manualOnly, true); assert.match(read('desktop/DesktopHost.cs'), /windowsGraphicsCapture=CaptureService\.WgcInstalled\(\)/);
});
