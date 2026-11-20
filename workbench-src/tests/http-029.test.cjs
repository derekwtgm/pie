'use strict';
// 0.29.0: investigation of the target PC's first-request HTTP 400. A corpus of request byte formats (Windows PowerShell 5.1 /
// .NET Framework HttpWebRequest shapes, loopback-proxy forwarding, security-product re-issue, Host variants, start-up race) is
// replayed into the REAL DesktopHost.cs compiled with Mono. Proves framing behaviour; NOT Windows networking or security software.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
const root = path.join(__dirname, '..'), read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const has = (c, a = ['--version']) => { try { cp.execFileSync(c, a, { stdio: 'pipe' }); return true; } catch (e) { return false; } };
const skip = has('mcs') && has('mono') ? false : 'Mono not installed';
test('every corpus request gets its expected status and structured code from the real host', { skip, timeout: 120000 }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'em-http-')), exe = path.join(d, 'r.exe');
  cp.execFileSync('mcs', ['-langversion:5', '-main:HttpCorpusReplay', '-r:System.Web.Extensions', '-r:System.Windows.Forms', '-r:System.Drawing', '-out:' + exe, ...['tests/mono/HttpCorpusReplay.cs', 'desktop/DesktopHost.cs', 'desktop/CaptureService.cs', 'desktop/InputBroker.cs'].map((f) => path.join(root, f))], { stdio: 'pipe' });
  const out = cp.execFileSync('mono', [exe, root, path.join(root, 'tests/fixtures/http-corpus')], { encoding: 'utf8', timeout: 110000, env: { ...process.env, XDG_DATA_HOME: path.join(d, 'data') } });
  const got = Object.fromEntries(out.trim().split('\n').map((l) => { const c = JSON.parse(l); let j = null; try { j = JSON.parse(c.body); } catch (e) {} return [c.case, { ...c, json: j }]; }));
  const exp = JSON.parse(read('tests/fixtures/http-corpus/expected.json'));
  for (const [name, e] of Object.entries(exp)) { assert.ok(got[name], name); assert.equal(got[name].status, e.status, name + ' ' + got[name].body); if (e.code) assert.equal(got[name].json.code, e.code, name); }
  assert.equal(got['connect-before-server-loop'].status, 200, 'a request queued before the accept loop starts is served, not refused');
  assert.equal(got['ps51-post-json-expect-100'].continue, true, 'the host sent 100 Continue before reading the body');
  assert.equal(got['proxy-absolute-form'].json.request.viaProxy, true); assert.equal(got['proxy-absolute-form'].json.request.absoluteForm, true);
  assert.equal(got['ps51-get-health'].json.request.viaProxy, false);
  assert.ok(Object.values(got).every((c) => c.status >= 200), 'every request was answered (no hang, no reset)');
});
test('the recorded 0.26-vs-0.29 comparison shows which formats the 0.26 host refused', () => {
  const r = JSON.parse(read('reports/0.29-http-corpus-026-vs-029.json')), by = Object.fromEntries(r.cases.map((c) => [c.case, c]));
  assert.equal(by['ps51-get-health'].host026.status, 200, 'PowerShell 5.1 own GET was accepted by 0.26: not the cause');
  for (const k of ['proxy-absolute-form', 'proxy-absolute-form-http10', 'localhost-host']) { assert.equal(by[k].host026.status, 400, k); assert.equal(by[k].host029.status, 200, k); }
  assert.match(by['ps51-post-json-expect-100'].host026.error, /framing/);
});
test('Test-Desktop.ps1 compares raw socket, system-proxy and no-proxy paths before the health check and states the diagnosis', () => {
  const s = read('windows/Test-Desktop.ps1');
  for (const k of ["'Loopback proxy bypass'", "'First-request diagnosis (0.26 HTTP 400)'", 'GetEmptyWebProxy', 'IsBypassed', 'SecurityCenter2', 'CAUSE FOUND']) assert.ok(s.includes(k), k);
  assert.ok(s.indexOf("Set-Step 'loopback-proxy'") < s.indexOf("Set-Step 'health'"));
});
