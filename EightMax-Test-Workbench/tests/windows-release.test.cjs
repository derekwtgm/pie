'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), os = require('node:os');
const root = path.join(__dirname, '..'), read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const hasMcs = (() => { try { cp.execFileSync('mcs', ['--version'], { stdio: 'pipe' }); return true; } catch (e) { return false; } })();

test('capture service uses only documented, ordinary window-capture calls: no memory access, injection, hooks, input synthesis or concealment', () => {
  const src = read('desktop/CaptureService.cs') + read('desktop/capture/EightMaxCapture.cs');
  for (const banned of ['ReadProcessMemory', 'WriteProcessMemory', 'VirtualAllocEx', 'CreateRemoteThread', 'SetWindowsHookEx', 'NtQuerySystemInformation', 'SendInput', 'mouse_event', 'keybd_event', 'SetForegroundWindow', 'OpenProcess', 'LoadLibrary', 'Detours', 'SetWindowDisplayAffinity', 'ShowWindow(']) assert.ok(!src.includes(banned), 'must not use ' + banned);
  for (const used of ['PrintWindow', 'BitBlt', 'DwmGetWindowAttribute', 'EnumWindows', 'EnumDisplayMonitors', 'GetDpiForWindow', 'SetThreadDpiAwarenessContext', 'IsIconic']) assert.ok(src.includes(used), 'expected ' + used);
  assert.match(src, /Windows Graphics Capture.*NOT implemented/s, 'the missing mechanism is stated in the source itself');
});
test('the desktop host exposes capture only behind the session token and explicit consent, and advertises what it really has', () => {
  const cs = read('desktop/DesktopHost.cs'); assert.match(cs, /X-EightMax-Session/); assert.ok(cs.indexOf('X-EightMax-Session', cs.indexOf('void Route(')) < cs.indexOf('StartsWith("/api/capture/"'), 'in Route(), the token check precedes dispatch to the capture routes');
  assert.match(cs, /needs explicit operator consent/); assert.match(cs, /windowsGraphicsCapture=false/); assert.match(cs, /captureMethods=new\[\]\{"print-window","screen-copy"\}/);
  for (const r of ['/api/capture/windows', '/api/capture/monitors', '/api/capture/open', '/api/capture/frame', '/api/capture/close', '/api/capture/audit']) assert.ok(cs.includes(r), r);
  assert.ok(!/SendInput|mouse_event|keybd_event/.test(cs), 'the host does not synthesise input');
});
test('C# sources compile (Mono mcs, x64): host + capture service and the stand-alone capture tool', { skip: hasMcs ? false : 'Mono mcs not installed: C# compilation NOT verified in this run' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em-cs-')), refs = ['-r:System.Windows.Forms.dll', '-r:System.Drawing.dll', '-r:System.Web.Extensions.dll'];
  try {
    cp.execFileSync('mcs', ['-platform:x64', '-target:winexe', ...refs, '-out:' + path.join(tmp, 'host.exe'), path.join(root, 'desktop/DesktopHost.cs'), path.join(root, 'desktop/CaptureService.cs')], { stdio: 'pipe' });
    cp.execFileSync('mcs', ['-platform:x64', '-target:exe', ...refs, '-out:' + path.join(tmp, 'cap.exe'), path.join(root, 'desktop/capture/EightMaxCapture.cs'), path.join(root, 'desktop/CaptureService.cs')], { stdio: 'pipe' });
    for (const f of ['host.exe', 'cap.exe']) assert.ok(fs.statSync(path.join(tmp, f)).size > 10000);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
function peInfo(file) { const b = fs.readFileSync(file), e = b.readUInt32LE(0x3c); assert.equal(b.toString('latin1', 0, 2), 'MZ'); assert.equal(b.toString('latin1', e, e + 4), 'PE\0\0'); return { machine: b.readUInt16LE(e + 4), magic: b.readUInt16LE(e + 24), subsystem: b.readUInt16LE(e + 24 + 68), size: b.length, text: b.toString('latin1') }; }
test('Windows PE metadata: shipped executables are x64 PE32+ images with the right subsystem', () => {
  const host = peInfo(path.join(root, 'desktop/bin/EightMaxWorkbench.exe')), cap = peInfo(path.join(root, 'desktop/bin/EightMaxCapture.exe')), mw = peInfo(path.join(root, 'native/mwcli.exe'));
  for (const x of [host, cap, mw]) { assert.equal(x.machine, 0x8664, 'AMD64'); assert.equal(x.magic, 0x20b, 'PE32+'); }
  assert.equal(host.subsystem, 2, 'windows GUI host'); assert.equal(cap.subsystem, 3, 'console tool'); assert.ok(host.text.includes('/api/capture/frame') || host.text.replace(/\0/g, '').includes('/api/capture/frame'), 'prebuilt host contains the capture routes');
  assert.ok(cap.text.replace(/\0/g, '').includes('SELFTEST PASS'));
});
test('PowerShell scripts: structural lint only (balanced delimiters, strict error handling). This is NOT a PowerShell parse; PowerShell was unavailable here', () => {
  const scripts = fs.readdirSync(path.join(root, 'windows')).filter((f) => f.endsWith('.ps1')).concat(['native/Run-Native-Study.ps1']); assert.ok(scripts.length >= 9);
  for (const f of scripts) {
    const text = f.includes('/') ? read(f) : read('windows/' + f), stripped = text.replace(/<#[\s\S]*?#>/g, '').replace(/#.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"`]|`.)*"/g, '""'); const st = [], pairs = { ')': '(', ']': '[', '}': '{' };
    for (const ch of stripped) { if ('([{'.includes(ch)) st.push(ch); else if (')]}'.includes(ch)) assert.equal(st.pop(), pairs[ch], f + ': unbalanced ' + ch); } assert.equal(st.length, 0, f + ': unclosed delimiters');
    if (['Test-Capture.ps1', 'Start-Desktop.ps1'].includes(f)) assert.match(text, /\$ErrorActionPreference\s*=\s*'Stop'/, f);
  }
  const cap = read('windows/Test-Capture.ps1'); for (const c of ['monitors-listed', 'windows-listed', 'selftest-window-capture-resize-minimize-lost']) assert.ok(cap.includes(c), c); assert.match(cap, /EightMaxCapture\.exe/);
  const start = read('windows/Start-Desktop.ps1'); assert.match(start, /CaptureService\.cs/, 'the compile fallback includes the capture service'); assert.match(start, /platform:x64/);
});
test('launchers point at scripts that exist; the release lists a capture acceptance entry point and a rollback', () => {
  for (const f of fs.readdirSync(root).filter((x) => x.endsWith('.cmd'))) { const m = /windows\\([A-Za-z-]+\.ps1)|native\\([A-Za-z-]+\.ps1)/.exec(read(f)); if (m) assert.ok(fs.existsSync(path.join(root, m[1] ? 'windows' : 'native', m[1] || m[2])), f + ' -> ' + (m[1] || m[2])); }
  assert.ok(fs.existsSync(path.join(root, 'RUN-CAPTURE-CHECK.cmd'))); assert.ok(fs.existsSync(path.join(root, 'ROLLBACK-WINDOWS.cmd')));
  const acc = read('docs/WINDOWS-ACCEPTANCE.md'); for (const k of ['RUN-CAPTURE-CHECK.cmd', 'EightMaxCapture.exe', 'NOT been run on Windows', 'minimis', 'DPI']) assert.match(acc, new RegExp(k, 'i'), k);
});
test('no package-manager or runtime install is needed on the target PC: the release carries everything it runs', () => {
  const html = read('START.html'); assert.ok(!/<script[^>]+src=/i.test(html)); assert.ok(!/node_modules|require\(['"](?!node:)/.test(read('windows/Start-Desktop.ps1')));
  assert.ok(fs.existsSync(path.join(root, 'native/mwcli.exe')) && fs.existsSync(path.join(root, 'desktop/bin/EightMaxWorkbench.exe'))); assert.ok(!/python|node\.exe|npm /i.test(read('START-DESKTOP.cmd') + read('INSTALL-WINDOWS.cmd')));
});
