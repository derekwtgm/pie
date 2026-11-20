'use strict';
// EightMax Test Workbench 0.28.0 - regression tests for the failures recorded on the target Windows PC with 0.26.0
// (EightMax-Windows-Test-Results-20261118-084905.zip). Evidence copies live in tests/fixtures/windows-0.26-evidence.
//
// What these tests can and cannot prove: they run the REAL C# sources compiled with Mono (Linux runtime, X11 WinForms) and the
// REAL PowerShell scripts under PowerShell 7 (Linux). They prove the control flow, protocol framing and harness reporting.
// They do NOT prove Windows behaviour (PrintWindow/BitBlt, .NET Framework, Windows PowerShell 5.1). That needs the
// RUN-RELEASE-ACCEPTANCE.cmd run on Windows; every test below that depends on a missing tool is SKIPPED with the reason.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const has = (cmd, args = ['--version']) => { try { cp.execFileSync(cmd, args, { stdio: 'pipe', timeout: 20000 }); return true; } catch (e) { return false; } };
const hasMcs = has('mcs'), hasMono = has('mono'), hasPwsh = has('pwsh', ['-NoProfile', '-Command', '1']);
const hasXvfb = has('which', ['Xvfb']), hasOpenbox = has('which', ['openbox']);
const stubSkip = process.platform === 'win32' ? 'shell-script tool stubs are Linux fixtures (the real tools run in RUN-RELEASE-ACCEPTANCE on Windows)' : !hasPwsh ? 'pwsh not installed' : false;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'em028-'));
const refs = ['-r:System.Web.Extensions', '-r:System.Windows.Forms', '-r:System.Drawing'];
function mcs(out, files, extra = []) { cp.execFileSync('mcs', ['-langversion:5', ...extra, ...refs, '-out:' + out, ...files.map((f) => path.join(root, f))], { stdio: 'pipe' }); return out; }

let display = null, xvfb = null, wm = null;
function ensureDisplay() {
  if (display) return display;
  const n = 90 + Math.floor(Math.random() * 400);
  xvfb = cp.spawn('Xvfb', [':' + n, '-screen', '0', '1280x800x24'], { stdio: 'ignore', detached: false });
  cp.execFileSync('sleep', ['1']);
  wm = cp.spawn('openbox', [], { env: { ...process.env, DISPLAY: ':' + n }, stdio: 'ignore' });
  cp.execFileSync('sleep', ['1']);
  display = ':' + n; return display;
}
test.after(() => { for (const p of [wm, xvfb]) if (p) try { p.kill(); } catch (e) {} });

// ---------------------------------------------------------------------------------------------------------------------
// 1. Evidence from the target PC is kept and its failure signatures are recognised.
test('0.26 Windows evidence: capture died after the minimised check and desktop acceptance failed with HTTP 400 + forced shutdown', () => {
  const ev = path.join(root, 'tests/fixtures/windows-0.26-evidence');
  const log = fs.readFileSync(path.join(ev, 'selftest.log')).toString('utf16le');
  assert.match(log, /minimised window correctly reported/);
  assert.doesNotMatch(log, /closed window correctly reported|SELFTEST PASS|SELFTEST FAIL/, 'the 0.26 tool never reached its closed-window check or summary');
  const cap = JSON.parse(fs.readFileSync(path.join(ev, 'capture-acceptance.json'), 'utf8').replace(/^﻿/, ''));
  const run = cap.checks.find((c) => c.check === 'acceptance-run');
  assert.equal(run.pass, false); assert.equal(run.detail, '', 'the 0.26 harness produced an EMPTY failure detail');
  const desk = JSON.parse(fs.readFileSync(path.join(ev, 'EightMax-desktop-acceptance.json'), 'utf8').replace(/^﻿/, ''));
  assert.match(desk.checks.find((c) => c.name === 'Desktop acceptance completed').message, /\(400\) Bad Request/);
  assert.equal(desk.checks.find((c) => c.name === 'Graceful desktop shutdown').passed, false);
});

// 2. Source-level guards that the two defects cannot silently return.
test('capture self-test never reads Form.Handle after Close() and always writes a stage result', () => {
  const src = read('desktop/capture/EightMaxCapture.cs');
  const body = src.slice(src.indexOf('static int SelfTest('));
  const close = body.indexOf('f.Close()');
  assert.ok(close > 0);
  const after = body.slice(close, body.indexOf('} catch (Exception e) {', close));
  assert.doesNotMatch(after, /f\.Handle|f\.Text|f\.ClientSize/, 'no Form member may be read once the form is closed');
  assert.match(body, /hwnd = f\.Handle; hwndText =/, 'the native handle is captured once while the window is alive');
  for (const stage of ['create-window', 'capture-original', 'verify-original-pixels', 'capture-resized', 'verify-resized-pixels', 'detect-minimized', 'capture-after-restore', 'detect-closed']) assert.ok(body.includes('"' + stage + '"'), stage);
  assert.match(body, /selftest-result\.json/);
  assert.match(src, /UnhandledException \+= /, 'an unexpected exception exits with code 4 instead of a crash dialog');
});
test('Test-Capture.ps1 no longer pipes native stderr through PowerShell (empty-detail failure of 0.26)', () => {
  const s = read('windows/Test-Capture.ps1').split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n');
  assert.doesNotMatch(s, /\*>&1|2>&1/);
  assert.match(s, /Invoke-EmTool/);
  assert.match(s, /selftest-result\.json/);
});
test('desktop host accepts Expect: 100-continue, returns structured errors and never logs the session token', () => {
  const s = read('desktop/DesktopHost.cs');
  assert.match(s, /HTTP\/1\.1 100 Continue/);
  assert.doesNotMatch(s, /headers\.ContainsKey\("Expect"\)\)throw new Exception\("Invalid local request framing\/host\."\)/);
  assert.match(s, /class RequestError/);
  assert.match(s, /code=code,status=status,method=/);
  const log = s.slice(s.indexOf('public sealed class RequestLog'), s.indexOf('void FlushLocked'));
  assert.doesNotMatch(log, /token|X-EightMax-Session|Body/i);
});
test('Test-Desktop.ps1 records step/method/route/status/code per request and always attempts orderly shutdown', () => {
  const s = read('windows/Test-Desktop.ps1');
  assert.match(s, /desktop-requests\.json/);
  assert.match(s, /GetResponseStream/);
  assert.match(s, /X-EightMax-Step/);
  assert.match(s, /finally \{[\s\S]*\/api\/desktop\/shutdown[\s\S]*WaitForExit\(20000\)/);
  assert.match(s, /Native process cleanup/);
  assert.doesNotMatch(s, /Expect100Continue/, 'the test must exercise the default PowerShell client behaviour, not hide it');
});

// 3. C# compiles at the C# 5 level used by the compile-on-first-launch fallback (Windows PowerShell CSharpCodeProvider).
test('all .NET Framework sources compile with Mono at C# 5 (cross-compilation only: NOT Windows execution)', { skip: hasMcs ? false : 'Mono mcs not installed' }, () => {
  const d = tmp();
  mcs(path.join(d, 'host.exe'), ['desktop/DesktopHost.cs', 'desktop/CaptureService.cs', 'desktop/InputBroker.cs'], ['-platform:x64', '-target:winexe', '-main:EightMax.Workbench.DesktopHost']);
  mcs(path.join(d, 'cap.exe'), ['desktop/capture/EightMaxCapture.cs', 'desktop/CaptureService.cs'], ['-platform:x64', '-target:exe']);
  assert.ok(fs.statSync(path.join(d, 'host.exe')).size > 50000);
});

// 4. The real request reader/router against the .NET HttpWebRequest client (as used by Windows PowerShell 5.1).
test('protocol: HttpWebRequest POST with body is no longer refused as "framing"; every refusal has a code', { skip: hasMcs && hasMono ? false : 'Mono not installed' }, () => {
  const d = tmp(); const exe = mcs(path.join(d, 'h.exe'), ['tests/mono/DesktopProtocolHarness.cs', 'desktop/DesktopHost.cs', 'desktop/CaptureService.cs', 'desktop/InputBroker.cs'], ['-main:DesktopProtocolHarness']);
  const out = cp.execFileSync('mono', [exe, root], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
  const cases = Object.fromEntries(out.trim().split('\n').filter((l) => l.startsWith('{')).map((l) => { const c = JSON.parse(l); return [c.case, c]; }));
  const body = (n) => JSON.parse(cases[n].body);
  assert.equal(cases['health-get'].status, 200);
  const expect = cases['cancel-intent-post-with-body-expect-100'];
  assert.equal(expect.status, 400); assert.equal(body('cancel-intent-post-with-body-expect-100').code, 'invalid-request');
  assert.equal(body('cancel-intent-post-with-body-expect-100').error, 'Unsupported native job.', 'reached job validation (0.26: "Invalid local request framing/host.")');
  assert.equal(body('cancel-intent-post-with-body-expect-100').step, 'cancel-intent-post-with-body-expect-100');
  assert.equal(cases['wrong-token'].status, 403); assert.equal(body('wrong-token').code, 'session-required');
  assert.equal(cases['foreign-origin'].status, 403);
  assert.equal(cases['capture-open-without-consent'].status, 400); assert.match(body('capture-open-without-consent').error, /consent/);
  assert.equal(cases['raw-localhost-host'].status, 200);
  const codes = { 'raw-bad-host': [400, 'invalid-host'], 'raw-chunked': [411, 'chunked-not-supported'], 'raw-expect-other': [417, 'expectation-failed'], 'raw-proxy-form': [403, 'session-required'] /* 0.29: own-host absolute form is accepted (RFC 7230); authentication still applies */, 'raw-get-with-body': [400, 'body-not-allowed'], 'raw-duplicate-header': [400, 'duplicate-header'], 'raw-oversize-body': [413, 'body-too-large'], 'raw-garbage': [400, 'unsupported-request-line'], 'unknown-route': [404, 'unknown-route'] };
  for (const [n, [st, code]] of Object.entries(codes)) { assert.equal(cases[n].status, st, n); assert.equal(body(n).code, code, n); assert.ok(body(n).error.length > 10, n); }
  assert.equal(cases['shutdown-post-no-body'].status, 200);
  assert.equal(cases['after-shutdown-health'].status, -1, 'listener closed after authenticated shutdown');
  const log = body('requests-log').entries.join('\n');
  assert.doesNotMatch(log, /[a-f0-9]{64}/, 'request log never contains the session token');
  assert.match(log, /GET \/api\/desktop\/health step=health-get status=200/);
});

// 5. The real capture self-test control flow (Mono WinForms on X11 + capture test double).
const selftestSkip = !(hasMcs && hasMono) ? 'Mono not installed' : !(hasXvfb && hasOpenbox) ? 'Xvfb/openbox not installed (needed for a real WinForms window that can be minimised)' : false;
test('capture self-test runs all stages to completion: create, capture, verify, resize, minimise, restore, close -> target-lost', { skip: selftestSkip }, () => {
  const d = tmp(); const exe = mcs(path.join(d, 'st.exe'), ['desktop/capture/EightMaxCapture.cs', 'tests/mono/FakeCaptureService.cs']);
  const env = { ...process.env, DISPLAY: ensureDisplay() };
  const r = cp.spawnSync('mono', [exe, 'selftest', d], { env, encoding: 'utf8', timeout: 90000 });
  const res = JSON.parse(fs.readFileSync(path.join(d, 'selftest-result.json'), 'utf8'));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(res.passed, true); assert.deepEqual(res.missingStages, []);
  assert.deepEqual(res.stages.map((s) => s.stage), ['create-window', 'capture-original', 'verify-original-pixels', 'capture-resized', 'verify-resized-pixels', 'detect-minimized', 'capture-after-restore', 'detect-closed']);
  assert.match(res.stages.at(-1).detail, /IsWindow=False reply code=target-lost/);
  assert.match(r.stdout, /SELFTEST PASS/);
});
test('capture self-test: an exception in a stage is recorded with its stage name and exit code 4 (no crash, result file written)', { skip: selftestSkip }, () => {
  const d = tmp(); const exe = mcs(path.join(d, 'st.exe'), ['desktop/capture/EightMaxCapture.cs', 'tests/mono/FakeCaptureService.cs']);
  const r = cp.spawnSync('mono', [exe, 'selftest', d], { env: { ...process.env, DISPLAY: ensureDisplay(), EIGHTMAX_FAKE_THROW_ON_LOST: '1' }, encoding: 'utf8', timeout: 90000 });
  assert.equal(r.status, 4);
  const res = JSON.parse(fs.readFileSync(path.join(d, 'selftest-result.json'), 'utf8'));
  assert.equal(res.harnessErrors, 1); assert.equal(res.stages.at(-1).stage, 'detect-closed'); assert.match(res.stages.at(-1).detail, /harness exception InvalidOperationException/);
});
test('WinForms runtime confirms the 0.26 mechanism: Form.Handle after Close() of a shown form throws ObjectDisposedException', { skip: selftestSkip }, () => {
  const d = tmp(); const exe = mcs(path.join(d, 'c.exe'), ['tests/mono/ClosedFormHandle.cs']);
  const r = cp.spawnSync('mono', [exe], { env: { ...process.env, DISPLAY: ensureDisplay() }, encoding: 'utf8', timeout: 60000 });
  const line = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(line.isDisposedAfterClose, true); assert.equal(line.pattern026, 'ObjectDisposedException'); assert.equal(line.pattern028SavedHandleNonZero, true);
});

// 6. The real desktop host process: graceful shutdown in several states (Mono runtime, headless message loop).
async function startHost(d) {
  const exe = mcs(path.join(d, 'EightMaxWorkbench.exe'), ['desktop/DesktopHost.cs', 'desktop/CaptureService.cs', 'desktop/InputBroker.cs'], ['-main:EightMax.Workbench.DesktopHost', '-target:winexe']);
  const ready = path.join(d, 'session.json');
  const proc = cp.spawn('mono', [exe, '--root', root, '--ready', ready, '--headless'], { env: { ...process.env, DISPLAY: ensureDisplay(), XDG_DATA_HOME: path.join(d, 'data') }, stdio: 'ignore' });
  const exited = new Promise((res) => proc.on('exit', (code) => res(code)));
  for (let i = 0; i < 100 && !fs.existsSync(ready); i++) await new Promise((r) => setTimeout(r, 100));
  const session = JSON.parse(fs.readFileSync(ready, 'utf8'));
  const api = async (p, method = 'GET', body, extra = {}) => { const r = await fetch(session.origin + p, { method, headers: { 'X-EightMax-Session': session.token, ...(body ? { 'Content-Type': 'application/json' } : {}), ...extra }, body }); return { status: r.status, json: await r.json() }; };
  return { proc, exited, ready, session, api, logDir: path.join(d, 'data', 'EightMax-Test-Workbench', 'Logs') };
}
const hostSkip = !(hasMcs && hasMono) ? 'Mono not installed' : !hasXvfb ? 'Xvfb not installed' : false;
test('host: authenticated shutdown ends the message loop by itself (no forced kill, no watchdog) in idle, after-error and stalled-connection states', { skip: hostSkip, timeout: 120000 }, async () => {
  const net = require('node:net');
  for (const scenario of ['idle', 'after-failed-requests', 'stalled-connection', 'wrong-token-first']) {
    const d = tmp(); const h = await startHost(d);
    let stalled = null;
    if (scenario === 'after-failed-requests') { assert.equal((await h.api('/api/native/jobs', 'POST', '{bad json')).status, 400); assert.equal((await h.api('/api/native/nope')).status, 404); }
    if (scenario === 'stalled-connection') { stalled = net.connect(48713, '127.0.0.1'); await new Promise((r) => stalled.on('connect', r)); }
    if (scenario === 'wrong-token-first') { const r = await fetch(h.session.origin + '/api/desktop/shutdown', { method: 'POST', headers: { 'X-EightMax-Session': '0'.repeat(64) } }); assert.equal(r.status, 403); assert.equal((await h.api('/api/desktop/health')).status, 200, 'an unauthenticated shutdown must not stop the host'); }
    const t0 = Date.now(); const bye = await h.api('/api/desktop/shutdown', 'POST');
    assert.equal(bye.status, 200); assert.equal(bye.json.stopping, true);
    const code = await Promise.race([h.exited, new Promise((r) => setTimeout(() => r('timeout'), 15000))]);
    if (stalled) stalled.destroy();
    assert.equal(code, 0, scenario + ': host exit code'); assert.ok(Date.now() - t0 < 9000, scenario + ': exited before the 10 s watchdog');
    assert.equal(fs.existsSync(h.ready), false, scenario + ': private session file removed');
    const log = fs.readFileSync(path.join(h.logDir, 'desktop-requests.log'), 'utf8');
    assert.match(log, /code=host-exit/); assert.doesNotMatch(log, /shutdown-watchdog/); assert.doesNotMatch(log, new RegExp(h.session.token));
  }
});
test('host: work is refused with 503 host-stopping once shutdown starts; double shutdown is harmless', { skip: hostSkip, timeout: 60000 }, async () => {
  const d = tmp(); const h = await startHost(d);
  const [a, b] = await Promise.all([h.api('/api/desktop/shutdown', 'POST'), h.api('/api/desktop/shutdown', 'POST').catch(() => ({ status: -1 }))]);
  // Both requests race on separate connections: exactly one starts the shutdown; the other gets 200 (also accepted) or 503 host-stopping.
  assert.ok([a.status, b.status].includes(200)); assert.ok([a.status, b.status].every((x) => [200, 503, -1].includes(x)));
  assert.equal(await Promise.race([h.exited, new Promise((r) => setTimeout(() => r('timeout'), 15000))]), 0);
});

// 7. PowerShell harness behaviour (PowerShell 7 on Linux; Windows PowerShell 5.1 is NOT available here).
test('all shipped PowerShell scripts parse (PowerShell 7 parser; Windows PowerShell 5.1 parse is re-checked by RUN-RELEASE-ACCEPTANCE)', { skip: hasPwsh ? false : 'pwsh not installed' }, () => {
  const script = "$bad=0;foreach($f in Get-ChildItem -Path (Join-Path $env:EMROOT 'windows'),(Join-Path $env:EMROOT 'native'),(Join-Path $env:EMROOT 'tests/pwsh') -Filter *.ps1){$t=$null;$e=$null;$null=[System.Management.Automation.Language.Parser]::ParseFile($f.FullName,[ref]$t,[ref]$e);foreach($x in $e){$bad++;Write-Output ($f.Name+': '+$x.Message)}};Write-Output \"errors=$bad\"";
  const out = cp.execFileSync('pwsh', ['-NoProfile', '-Command', script], { env: { ...process.env, EMROOT: root }, encoding: 'utf8' });
  assert.match(out, /errors=0/, out);
});
test('Common.ps1 reporting helpers: exact counts, never-empty messages, stderr captured not thrown, timeouts classified', { skip: hasPwsh ? false : 'pwsh not installed' }, () => {
  const r = cp.spawnSync('pwsh', ['-NoProfile', '-File', path.join(root, 'tests/pwsh/Common.Tests.ps1'), '-Root', root], { encoding: 'utf8', timeout: 60000 }), out = (r.stdout || '') + (r.stderr || '');
  assert.match(out, /pwsh-failures: 0/, out); assert.doesNotMatch(out, /^not ok/m);
});
test('Test-Capture.ps1 replaying the 0.26 crash reports the exact failing stage with the crash text (not an empty detail)', { skip: stubSkip }, () => {
  const d = tmp();
  const r = cp.spawnSync('pwsh', ['-NoProfile', '-File', path.join(root, 'windows/Test-Capture.ps1'), '-OutDir', d, '-Tool', path.join(root, 'tests/fixtures/capture-stubs/capture-026-crash.sh')], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 1);
  const rep = JSON.parse(fs.readFileSync(path.join(d, 'capture-acceptance.json'), 'utf8'));
  const st = rep.checks.find((c) => c.check === 'selftest-completed');
  assert.equal(st.status, 'fail'); assert.match(st.detail, /exited with code 134/); assert.match(st.detail, /ObjectDisposedException/);
  assert.equal(rep.checks.find((c) => c.check === 'capture-tool-version').errorCode, 'capture-tool-outdated');
  assert.equal(rep.checks.find((c) => c.check === 'monitors-listed').status, 'pass', 'later stages still run after an earlier failure');
  for (const c of rep.checks) assert.ok(c.detail && c.detail.length > 0, c.check);
  assert.equal(rep.counts.failed, rep.checks.filter((c) => c.status === 'fail').length);
});
test('Test-Capture.ps1 with a passing 0.28 tool reports every self-test stage', { skip: stubSkip }, () => {
  const d = tmp();
  const r = cp.spawnSync('pwsh', ['-NoProfile', '-File', path.join(root, 'windows/Test-Capture.ps1'), '-OutDir', d, '-Tool', path.join(root, 'tests/fixtures/capture-stubs/capture-028-pass.sh')], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const rep = JSON.parse(fs.readFileSync(path.join(d, 'capture-acceptance.json'), 'utf8'));
  assert.equal(rep.passed, true); assert.equal(rep.counts.failed, 0);
  assert.ok(rep.checks.some((c) => c.check === 'selftest:detect-closed' && c.status === 'pass'));
});

// 8. Windows Graphics Capture acceptance script, results collector and the critical acceptance mapping.
test('Test-Wgc.ps1 reports every WGC self-test stage plus refusals (stub tool; the real helper has not run on Windows)', { skip: stubSkip }, () => {
  const d = tmp();
  const r = cp.spawnSync('pwsh', ['-NoProfile', '-File', path.join(root, 'windows/Test-Wgc.ps1'), '-OutDir', d, '-Tool', path.join(root, 'tests/fixtures/capture-stubs/wgc-028-pass.sh')], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const rep = JSON.parse(fs.readFileSync(path.join(d, 'wgc-acceptance.json'), 'utf8'));
  for (const c of ['wgc-tool-version', 'wgc-supported', 'wgc:first-frame', 'wgc:resize-detected', 'wgc:refuse-wrong-process', 'wgc:detect-minimized', 'wgc:recover-after-restore', 'wgc:repeated-sessions-and-cleanup', 'wgc:detect-closed', 'wgc-selftest-completed', 'wgc-invalid-handle-refused', 'wgc-bad-arguments-refused']) assert.equal(rep.checks.find((x) => x.check === c)?.status, 'pass', c);
});
test('WGC self-test stage names match the acceptance script and the helper source', () => {
  const src = read('desktop/wgc/SelfTest.cs');
  for (const st of ['create-window', 'session-start', 'first-frame', 'verify-original-pixels', 'resize-detected', 'verify-resized-pixels', 'refuse-wrong-process', 'detect-minimized', 'recover-after-restore', 'frame-sequence', 'repeated-sessions-and-cleanup', 'detect-closed', 'refuse-closed-handle']) assert.ok(src.includes('"' + st + '"'), st);
  const prog = read('desktop/wgc/Program.cs');
  assert.match(prog, /--session/); assert.match(prog, /Recreate\(/, 'resolution changes recreate the frame pool'); assert.match(prog, /queue\.Count >= capacity\) \{ queue\.Dequeue\(\); Dropped\+\+/, 'bounded frame queue');
  assert.match(prog, /SystemRelativeTime/); assert.doesNotMatch(prog, /IsBorderRequired\s*=\s*false/, 'the capture border stays visible');
  assert.doesNotMatch(prog, /^using System\.Drawing|new Bitmap\(/m, '.NET 8 base has no System.Drawing.Bitmap (0.26 compile error)');
});
test('every critical acceptance criterion in Test-Release.ps1 refers to checks the child scripts actually produce', () => {
  const rel = read('windows/Test-Release.ps1'), desk = read('windows/Test-Desktop.ps1'), cap = read('desktop/capture/EightMaxCapture.cs'), capPs = read('windows/Test-Capture.ps1');
  const block = rel.slice(rel.indexOf('$critical=@('), rel.indexOf('$final=Complete-EmReport'));
  const names = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((n) => /\//.test(n) || ['release-integrity', 'powershell-parse-all-scripts', 'no-orphaned-processes'].includes(n));
  assert.ok(names.length >= 16);
  for (const n of names) {
    if (n.startsWith('desktop/')) assert.ok(desk.includes("'" + n.slice(8) + "'"), n);
    else if (n.startsWith('capture/selftest:')) assert.ok(cap.includes('"' + n.slice(17) + '"'), n);
    else if (n.startsWith('capture/')) assert.ok(capPs.includes("'" + n.slice(8) + "'"), n);
    else assert.ok(rel.includes("Add-EmCheck $report '" + n + "'"), n);
  }
  for (const c of ['Archive integrity', 'PowerShell parsing', 'Monitor detection', 'Window enumeration', 'Capture and resize', 'Minimized-window detection', 'Closed-window detection', 'Capture acceptance completion', 'Desktop local API communication', 'Native solver startup', 'Authenticated graceful shutdown', 'Native process cleanup']) assert.ok(block.includes("'" + c + "'"), c);
});
test('results collector: reads the real 0.26 reports, never modifies originals, excludes session files, redacts tokens/names, writes portable ZIP paths', { skip: !hasPwsh ? 'pwsh not installed' : !has('python3') ? 'python3 not available to read the ZIP' : false }, () => {
  const d = tmp(), src = path.join(d, 'la'), out = path.join(d, 'out'), ev = path.join(root, 'tests/fixtures/windows-0.26-evidence');
  fs.mkdirSync(path.join(src, 'ReleaseAcceptance', 'run1', 'capture'), { recursive: true }); fs.mkdirSync(path.join(src, 'Diagnostics', 'desktop-x'), { recursive: true }); fs.mkdirSync(path.join(src, 'Diagnostics', 'NativeJobs'), { recursive: true });
  const tok = 'ab'.repeat(32);
  fs.copyFileSync(path.join(ev, 'capture-acceptance.json'), path.join(src, 'ReleaseAcceptance', 'run1', 'capture', 'capture-acceptance.json'));
  fs.copyFileSync(path.join(ev, 'selftest.log'), path.join(src, 'ReleaseAcceptance', 'run1', 'capture', 'selftest.log'));
  fs.copyFileSync(path.join(ev, 'release-acceptance.json'), path.join(src, 'ReleaseAcceptance', 'run1', 'release-acceptance.json'));
  fs.writeFileSync(path.join(src, 'Diagnostics', 'desktop-x', 'EightMax-desktop-acceptance.json'), fs.readFileSync(path.join(ev, 'EightMax-desktop-acceptance.json'), 'utf8').replace('Bad Request.', 'Bad Request. C:\\\\Users\\\\alice\\\\AppData on ALICE-PC'));
  fs.writeFileSync(path.join(src, 'Diagnostics', 'desktop-x', 'private-session.json'), JSON.stringify({ token: tok }));
  fs.writeFileSync(path.join(src, 'Diagnostics', 'desktop-x', 'host.log'), 'GET /api X-EightMax-Session: ' + tok + '\n"token":"' + tok + '"\npassword=hunter2\n');
  fs.writeFileSync(path.join(src, 'Diagnostics', 'NativeJobs', 'status.json'), '{}');
  const hash = (dir) => { const h = require('node:crypto').createHash('sha256'); for (const f of fs.readdirSync(dir, { recursive: true }).sort()) { const p = path.join(dir, f); if (fs.statSync(p).isFile()) h.update(f).update(fs.readFileSync(p)); } return h.digest('hex'); };
  const before = hash(src);
  const r = cp.spawnSync('pwsh', ['-NoProfile', '-File', path.join(root, 'windows/Collect-TestResults.ps1'), '-SearchRoot', [path.join(src, 'ReleaseAcceptance'), path.join(src, 'Diagnostics')].join(','), '-Destination', out, '-NoUi', '-UserNameOverride', 'alice', '-MachineOverride', 'ALICE-PC'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(hash(src), before, 'original reports unchanged');
  const zipPath = path.join(out, fs.readdirSync(out).find((f) => /^EightMax-Windows-Test-Results-\d{8}-\d{6}\.zip$/.test(f)));
  const list = cp.execFileSync('python3', ['-c', 'import zipfile,sys,json;z=zipfile.ZipFile(sys.argv[1]);print(json.dumps({n:z.read(n).decode("utf-8","replace") for n in z.namelist() if not n.endswith(".png")}))', zipPath], { encoding: 'utf8' });
  const files = JSON.parse(list), names = Object.keys(files), all = Object.values(files).join('\n');
  assert.ok(names.every((n) => !n.includes('\\')), 'forward-slash entry names (the 0.26-era ZIP used backslashes)');
  assert.ok(!names.some((n) => /private-session|NativeJobs/.test(n)), 'private session and native job folders excluded');
  assert.ok(!all.includes(tok) && !all.includes('hunter2') && !/alice/i.test(all), 'tokens, secrets, user and computer names redacted');
  const s = JSON.parse(files['collect-summary.json'].replace(/^\uFEFF/, ''));
  assert.equal(s.format, 'eightmax-test-results-summary'); assert.equal(s.testsCompleted, 3); assert.equal(s.testsFailed, 3);
  assert.ok(s.mainFailureReasons.some((x) => /400/.test(x.detail))); assert.ok(s.mainFailureReasons.some((x) => /empty detail/.test(x.detail)));
  assert.ok(files['README-RESULTS.txt'].includes('MAIN FAILURE REASONS'));
});
