'use strict';
/* Windows Graphics Capture helper - 0.28 checks kept in 0.29 (file renamed from wgc-026; 0.27's wgc-027.test.cjs covers build, PNG and route).
 * 0.28.0: desktop/wgc COMPILES (cross-compiled on Linux with the .NET 8 SDK) and ships as desktop/bin/EightMaxWgc.exe.
 * It has NOT been executed on Windows. These tests check build identity, documented-API use and safety by inspection;
 * they do NOT prove that it captures anything. That needs RUN-WGC-CHECK.cmd on Windows. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..'), read = (p) => fs.readFileSync(path.join(root, p), 'utf8'), CM = require('../src/capture-manager.js');
test('catalogue: WGC is implemented but unverified on Windows; documents say compiled / not run', () => {
  const c = CM.CATALOG['windows-graphics-capture']; assert.equal(c.implemented, true); assert.equal(c.verification, 'compiled-windows-unrun'); assert.equal(c.manualOnly, true); assert.match(c.note, /NEVER been run on Windows/); assert.match(c.note, /never silently replaced/);
  assert.match(read('docs/WINDOWS-GRAPHICS-CAPTURE.md'), /NOT VERIFIED ON THE TARGET PC/);
  const comp = JSON.parse(read('desktop/COMPONENT-VERSIONS.json')).components['desktop/bin/EightMaxWgc.exe']; assert.equal(comp.status.builtFromSourceForThisRelease, true); assert.equal(comp.status.testedOnTargetHardware, false);
});
test('the shipped helper is a Windows x64 PE that identifies itself as 0.35.0 and matches its recorded hash', () => {
  const b = fs.readFileSync(path.join(root, 'desktop/bin/EightMaxWgc.exe')), e = b.readUInt32LE(0x3c);
  assert.equal(b.toString('latin1', 0, 2), 'MZ'); assert.equal(b.readUInt16LE(e + 4), 0x8664, 'x64'); assert.equal(b.readUInt16LE(e + 24), 0x20b, 'PE32+');
  assert.equal(require('node:crypto').createHash('sha256').update(b).digest('hex'), JSON.parse(read('desktop/COMPONENT-VERSIONS.json')).components['desktop/bin/EightMaxWgc.exe'].sha256);
  // Cross-compiled on Linux: the SDK cannot stamp the app version into the single-file host's Win32 resource; the tool reports it via --version.
  assert.match(read('desktop/wgc/Program.cs'), /--version/); /* 0.29: file properties also verified on Windows CI */
  assert.match(read('desktop/wgc/Program.cs'), /public const string Version = "0\.35\.0"/); assert.match(read('desktop/wgc/EightMaxWgc.csproj'), /<Version>0\.35\.0<\/Version>/);
  assert.match(read('windows/Test-Release.ps1'), /EightMaxWgc\.exe','--version'/);
});
test('source uses documented capture APIs and refuses lost, reused-handle, minimised, stale, blank and unsupported targets', () => {
  const s = read('desktop/wgc/Program.cs');
  for (const m of ['GraphicsCaptureSession.IsSupported', 'IGraphicsCaptureItemInterop', 'CreateForWindow', 'CreateForMonitor', 'Direct3D11CaptureFramePool.CreateFreeThreaded', 'CreateDirect3D11DeviceFromDXGIDevice', 'IDirect3DDxgiInterfaceAccess', 'D3D11CreateDevice', 'StartCapture', 'Recreate(']) assert.ok(s.includes(m), m);
  for (const code of ['target-lost', 'target-identity-changed', 'target-minimized', 'stale-frame', 'blank-frame', 'no-frame', 'unsupported', 'capture-timeout', 'resized']) assert.ok(s.includes('"' + code + '"') || s.includes('\\"' + code + '\\"'), code);
});
test('safety: no memory access, injection, hooks, input synthesis, hidden windows or network in the helper or its scripts', () => {
  const all = [read('desktop/wgc/Program.cs'), read('desktop/wgc/SelfTest.cs'), read('desktop/wgc/EightMaxWgc.csproj'), read('windows/Build-WgcCapture.ps1'), read('windows/Test-Wgc.ps1')].join('\n');
  for (const banned of ['WriteProcessMemory', 'ReadProcessMemory', 'VirtualAllocEx', 'CreateRemoteThread', 'SetWindowsHookEx', 'SendInput', 'keybd_event', 'mouse_event', 'SetWindowDisplayAffinity', 'Invoke-WebRequest', 'WebClient', 'HttpClient', 'DllInjection', 'OpenProcess']) assert.ok(!all.includes(banned), banned);
  assert.ok(!/PackageReference/.test(read('desktop/wgc/EightMaxWgc.csproj')), 'no NuGet dependency'); assert.match(read('desktop/wgc/EightMaxWgc.csproj'), /SelfContained>true/); assert.match(read('desktop/wgc/app.manifest'), /PerMonitorV2/);
});
test('the host advertises WGC only when the helper exists and never substitutes another backend (0.27 route in CaptureService)', () => {
  const s = read('desktop/DesktopHost.cs'), cs = read('desktop/CaptureService.cs');
  assert.match(s, /windowsGraphicsCapture=CaptureService\.WgcInstalled\(\),windowsGraphicsCaptureVerified=false/);
  assert.match(s, /reply=CaptureService\.GrabJson\(target\);/); assert.match(cs, /if \(t\.Method == WgcMethod\) return GrabWgc\(t, t0\);/);
  assert.match(cs, /HelperRoot/, 'helper found next to the release root even when the host was compiled into DesktopCache');
});
test('launchers exist, call the right script and the acceptance script reports honestly', () => {
  assert.match(read('BUILD-WGC.cmd'), /Build-WgcCapture\.ps1/); assert.match(read('RUN-WGC-CHECK.cmd'), /Test-Wgc\.ps1/);
  const t = read('windows/Test-Wgc.ps1'); assert.match(t, /NEVER been executed on Windows before this check/); assert.match(t, /wgc-invalid-handle-refused/); assert.match(t, /wgc-bad-arguments-refused/);
  assert.match(read('desktop/wgc/SelfTest.cs'), /"refuse-wrong-process"/); assert.match(read('desktop/wgc/SelfTest.cs'), /"detect-closed"/);
});
