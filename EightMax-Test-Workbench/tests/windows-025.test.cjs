'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), os = require('node:os');
const root = path.join(__dirname, '..'), read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const hasMcs = (() => { try { cp.execFileSync('mcs', ['--version'], { stdio: 'pipe' }); return true; } catch (e) { return false; } })();

test('0.25 acceptance orchestrator: structure, honest reporting, no network, no unsafe calls (NOT executed here: no Windows, no PowerShell)', () => {
  const t = read('windows/Test-Release.ps1');
  assert.match(t, /\$ErrorActionPreference='Stop'/); assert.match(t, /NOT run in the build environment/);
  for (const c of ['release-integrity', 'powershell-parse-all-scripts', 'platform-workspace-present', 'capture-selftest-printwindow-bitblt', 'desktop-host-native-diagnostics', 'shutdown-leaves-no-native-process', 'install', 'rollback', 'uninstall']) assert.ok(t.includes(c), c);
  assert.match(t, /Windows Graphics Capture is NOT implemented/); assert.match(t, /'skipped'/, 'skipped checks are reported as skipped, never as passed');
  assert.ok(!/Invoke-WebRequest|Invoke-RestMethod|DownloadFile|curl|Start-BitsTransfer/i.test(t), 'no downloads'); assert.ok(!/python|node\.exe|npm /i.test(t));
  let depth = 0, braces = 0; for (const ch of t.replace(/'[^']*'/g, "''")) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === '{') braces++; if (ch === '}') braces--; } assert.equal(depth, 0, 'balanced parentheses'); assert.equal(braces, 0, 'balanced braces');
  assert.match(read('RUN-RELEASE-ACCEPTANCE.cmd'), /windows\\Test-Release\.ps1/); assert.ok(fs.existsSync(path.join(root, 'windows/Test-Release.ps1')));
  assert.ok(!/python|node\.exe|npm /i.test(read('START-DESKTOP.cmd') + read('INSTALL-WINDOWS.cmd')), 'launcher and installer need no Python or Node.js');
});
test('every Windows script and launcher agrees on version 0.25.0', () => {
  for (const f of ['windows/Install-Workbench.ps1', 'windows/Start-Workbench.ps1', 'windows/Test-Desktop.ps1', 'windows/Test-Capture.ps1', 'windows/Test-Release.ps1', 'desktop/DesktopHost.cs']) assert.match(read(f), /0\.25\.0/, f);
  assert.ok(!/0\.24\.0/.test(read('windows/Install-Workbench.ps1')));
});
test('rebuilt Windows executables carry 0.25.0 and are x64 PE32+; sources compile with Mono (cross-compilation only: NOT Windows execution)', { skip: hasMcs ? false : 'Mono mcs not installed' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em25-')), refs = ['-r:System.Windows.Forms.dll', '-r:System.Drawing.dll', '-r:System.Web.Extensions.dll'];
  try {
    cp.execFileSync('mcs', ['-platform:x64', '-target:winexe', '-optimize+', ...refs, '-out:' + path.join(tmp, 'host.exe'), path.join(root, 'desktop/DesktopHost.cs'), path.join(root, 'desktop/CaptureService.cs')], { stdio: 'pipe' });
    const fresh = fs.readFileSync(path.join(tmp, 'host.exe')), shipped = fs.readFileSync(path.join(root, 'desktop/bin/EightMaxWorkbench.exe'));
    assert.equal(fresh.length, shipped.length, 'shipped host has the size of a fresh build of the shipped source');
    assert.ok(shipped.toString('utf16le').includes('0.25.0') || shipped.toString('latin1').replace(/\0/g, '').includes('0.25.0'), 'shipped host embeds 0.25.0');
    const e = shipped.readUInt32LE(0x3c); assert.equal(shipped.readUInt16LE(e + 4), 0x8664); assert.equal(shipped.readUInt16LE(e + 24), 0x20b);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
test('capture catalogue and host agree: Windows Graphics Capture is declared absent in both the JS catalogue and the host', () => {
  const CM = require('../src/capture-manager.js'); assert.equal(CM.CATALOG['windows-graphics-capture'].implemented, false); assert.match(read('desktop/DesktopHost.cs'), /windowsGraphicsCapture=false/);
});
