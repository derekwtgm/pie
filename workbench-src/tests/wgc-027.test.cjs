'use strict';
/* 0.27 Windows Graphics Capture. WHAT THESE TESTS PROVE: the helper source compiles to a win-x64 executable (when the .NET SDK is present), the PNG encoder it uses is
 * bit-exact, the host routes WGC only on explicit request and never falls back silently, and the safety properties hold by static inspection.
 * WHAT THEY DO NOT PROVE: that any frame was ever captured. Nothing here ran on Windows. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), cp = require('node:child_process'), zlib = require('node:zlib');
const root = path.join(__dirname, '..'), read = (p) => fs.readFileSync(path.join(root, p), 'utf8'), CM = require('../src/capture-manager.js');
const hasDotnet = (() => { try { cp.execFileSync('dotnet', ['--version'], { stdio: 'pipe' }); return true; } catch (e) { return false; } })();

test('catalogue: WGC is compiled-but-unrun, manual-only; documents and component file say so plainly', () => {
  const c = CM.CATALOG['windows-graphics-capture']; assert.equal(c.implemented, true); assert.equal(c.manualOnly, true); assert.equal(c.verification, 'compiled-windows-unrun'); assert.match(c.note, /NEVER been run on Windows/);
  assert.match(read('docs/WINDOWS-GRAPHICS-CAPTURE.md'), /NOT VERIFIED ON THE TARGET PC/); assert.equal(JSON.parse(read('desktop/COMPONENT-VERSIONS.json')).components['desktop/bin/EightMaxWgc.exe'].status.testedOnTargetHardware, false);
  const auto = CM.selectBackend(['windows-graphics-capture', 'printwindow'], ['windows-graphics-capture', 'printwindow'], {}); assert.equal(auto.id, 'printwindow', 'never chosen automatically'); assert.match(auto.skipped[0].reason, /chosen by the operator/);
  assert.equal(CM.selectBackend(['windows-graphics-capture', 'printwindow'], ['windows-graphics-capture'], {}, { explicit: true }).id, 'windows-graphics-capture');
});
test('the shipped helper is a win-x64 PE32+ executable and the host and capture tool were rebuilt from the shipped sources', () => {
  for (const f of ['desktop/bin/EightMaxWgc.exe', 'desktop/bin/EightMaxWorkbench.exe', 'desktop/bin/EightMaxCapture.exe']) { const b = fs.readFileSync(path.join(root, f)); assert.equal(b.readUInt16LE(0), 0x5a4d, f); const e = b.readUInt32LE(0x3c); assert.equal(b.readUInt32LE(e), 0x4550); assert.equal(b.readUInt16LE(e + 4), 0x8664, f + ' is x64'); assert.equal(b.readUInt16LE(e + 24), 0x20b, f + ' is PE32+'); }
  const comp = JSON.parse(read('desktop/COMPONENT-VERSIONS.json')); assert.equal(comp.appVersion, '0.35.0'); for (const [k, v] of Object.entries(comp.components)) { assert.ok(fs.existsSync(path.join(root, k)), k); if (/node\.exe|mwcli/.test(k)) continue; assert.equal(v.status.builtFromSourceForThisRelease, true, k); }
});
test('the helper source compiles for win-x64 (cross-compiled; needs the .NET 8 SDK)', { skip: hasDotnet ? false : '.NET SDK not installed: WGC compilation NOT verified in this run', timeout: 600000 }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em-wgc-')); try {
    for (const f of ['EightMaxWgc.csproj', 'Program.cs', 'SelfTest.cs', 'PngWriter.cs', 'app.manifest']) fs.copyFileSync(path.join(root, 'desktop/wgc', f), path.join(tmp, f));
    const out = cp.execFileSync('dotnet', ['build', '-c', 'Release', '-p:EnableWindowsTargeting=true', '-nologo', '-v', 'q'], { cwd: tmp, stdio: 'pipe', timeout: 590000 }).toString(); assert.ok(!/error CS/.test(out), out);
    assert.ok(fs.existsSync(path.join(tmp, 'bin/Release/net8.0-windows10.0.22000.0/win-x64/EightMaxWgc.dll')));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
test('the PNG writer used by the helper is bit-exact (CRC-32 and every pixel verified here)', { skip: hasDotnet ? false : '.NET SDK not installed', timeout: 300000 }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em-png-')); try {
    const proj = path.join(tmp, 'proj'); fs.mkdirSync(proj); fs.copyFileSync(path.join(root, 'desktop/wgc/PngWriter.cs'), path.join(proj, 'PngWriter.cs')); fs.copyFileSync(path.join(root, 'tools/wgc-png-check/Program.cs'), path.join(proj, 'Program.cs')); fs.writeFileSync(path.join(proj, 'WgcPngCheck.csproj'), fs.readFileSync(path.join(root, 'tools/wgc-png-check/WgcPngCheck.csproj'), 'utf8').replace(/<ItemGroup>.*?<\/ItemGroup>/s, '')); cp.execFileSync('dotnet', ['build', '-c', 'Release', '-nologo', '-v', 'q', '-o', path.join(tmp, 'out')], { cwd: proj, stdio: 'pipe', timeout: 280000 }); const outDir = path.join(tmp, 'out');   // built in a temp copy: nothing is written into the release tree
    for (const [w, h] of [[37, 23], [1, 1], [640, 360]]) {
      const png = path.join(tmp, 'o' + w + '.png'); cp.execFileSync('dotnet', [path.join(outDir, 'WgcPngCheck.dll'), png, String(w), String(h)], { stdio: 'pipe' }); const d = fs.readFileSync(png);
      assert.deepEqual([...d.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]); let i = 8, idat = [], hdr = null;
      while (i < d.length) { const n = d.readUInt32BE(i), type = d.subarray(i + 4, i + 8).toString('latin1'), body = d.subarray(i + 8, i + 8 + n); assert.equal(d.readUInt32BE(i + 8 + n) >>> 0, zlib.crc32(Buffer.concat([d.subarray(i + 4, i + 8), body])) >>> 0, 'CRC of ' + type); if (type === 'IDAT') idat.push(body); if (type === 'IHDR') hdr = body; i += 12 + n; }
      assert.equal(hdr.readUInt32BE(0), w); assert.equal(hdr.readUInt32BE(4), h); assert.equal(hdr[8], 8); assert.equal(hdr[9], 6); const raw = zlib.inflateSync(Buffer.concat(idat)); assert.equal(raw.length, (w * 4 + 1) * h);
      for (let y = 0; y < h; y++) { assert.equal(raw[y * (w * 4 + 1)], 0); for (let x = 0; x < w; x++) { const o = y * (w * 4 + 1) + 1 + x * 4; assert.deepEqual([raw[o], raw[o + 1], raw[o + 2], raw[o + 3]], [((x + y) * 3) & 255, (y * 5) & 255, (x * 7) & 255, 255]); } }
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
test('source uses documented capture APIs and refuses blank, stale, lost, reused-handle, minimised and resized targets', () => {
  const s = read('desktop/wgc/Program.cs');
  for (const m of ['GraphicsCaptureSession.IsSupported', 'IGraphicsCaptureItemInterop', 'CreateForWindow', 'CreateForMonitor', 'Direct3D11CaptureFramePool.CreateFreeThreaded', 'CreateDirect3D11DeviceFromDXGIDevice', 'IDirect3DDxgiInterfaceAccess', 'D3D11CreateDevice', 'StartCapture']) assert.ok(s.includes(m), m);
  for (const code of ['target-lost', 'target-identity-changed', 'target-minimized', 'stale-frame', 'blank-frame', 'resolution-changed', 'no-frame', 'unsupported']) assert.ok(s.includes('"' + code + '"'), code);
});
test('host route: WGC only on explicit request, identity-checked first, time-limited, persistent session (0.29), no fallback', () => {
  const cs = read('desktop/CaptureService.cs'), host = read('desktop/DesktopHost.cs');
  assert.match(cs, /if \(t\.Method == WgcMethod\) return GrabWgc\(t, t0\);/); const g = cs.slice(cs.indexOf('static string GrabWgc'), cs.indexOf('public sealed class Target'));
  assert.ok(g.indexOf('CheckWindow(t, out h, out min)') < g.indexOf('StreamFrame('), 'identity is checked before the helper runs'); assert.match(cs, /Math\.Max\(waitMs, 5000\)/, 'first frame bounded (0.29 persistent session)'); assert.match(g, /backend-unavailable/); assert.ok(!/PrintWindow\(|BitBlt\(/.test(g), 'GrabWgc never calls the other capture methods');
  assert.match(host, /method=="windows-graphics-capture"/); assert.match(host, /windowsGraphicsCapture=CaptureService\.WgcInstalled\(\)/);
});
test('safety: no memory access, injection, hooks, input synthesis, hidden windows or network in the helper or its scripts', () => {
  const all = [read('desktop/wgc/Program.cs'), read('desktop/wgc/SelfTest.cs'), read('desktop/wgc/PngWriter.cs'), read('desktop/wgc/EightMaxWgc.csproj'), read('windows/Build-WgcCapture.ps1'), read('windows/Test-Wgc.ps1')].join('\n');
  for (const banned of ['WriteProcessMemory', 'ReadProcessMemory', 'VirtualAllocEx', 'CreateRemoteThread', 'SetWindowsHookEx', 'SendInput', 'keybd_event', 'mouse_event', 'SetWindowDisplayAffinity', 'Invoke-WebRequest', 'WebClient', 'HttpClient', 'DllInjection', 'OpenProcess']) assert.ok(!all.includes(banned), banned);
  assert.ok(!/PackageReference/.test(read('desktop/wgc/EightMaxWgc.csproj')), 'no NuGet dependency'); assert.match(read('desktop/wgc/EightMaxWgc.csproj'), /SelfContained>true/); assert.match(read('desktop/wgc/app.manifest'), /PerMonitorV2/); assert.ok(!/System\.Drawing/.test(read('desktop/wgc/Program.cs')), 'no System.Drawing dependency');
});
test('launchers and acceptance script exist and report honestly', () => {
  assert.match(read('BUILD-WGC.cmd'), /Build-WgcCapture\.ps1/); assert.match(read('RUN-WGC-CHECK.cmd'), /Test-Wgc\.ps1/);
  const t = read('windows/Test-Wgc.ps1'); assert.match(t, /NOT RUN on Windows/); assert.match(t, /invalid window is refused/); assert.match(t, /wrong process id is refused/); assert.match(t, /closed window is refused/);
});
