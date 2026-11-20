'use strict';
// 0.35.0 release: controlled test table (status strip, dealer, oracle), launchers, host routes and whitelist, dashboard wiring,
// documentation, and the EightMax 5.1 identity (this release must not change the solver).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..'), read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const SS = require('../src/status-strip.js'), FD = require('../src/fixture-dealer.js'), IC = require('../src/image-codec.js'), PP = require('../src/platform-profile.js'), G = require('../src/input-geometry.js'), SP = require('../src/simulator-profiles.js');

test('status strip: round trip at every width, refuses corrupted or scaled strips, overlaps nothing the reader uses', () => {
  { const w = 480, h = 300, img = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; SS.draw(img, { table: 1, viewSeat: 0, playing: true, revision: 1 }); assert.equal(SS.read(img).ok, false, 'too small to read: refused, never guessed'); }
  for (const w of [640, 800, 960, 1337, 1920, 3200]) { const h = Math.round(w / 1.6), img = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    SS.draw(img, { table: 9, viewSeat: 6, playing: true, revision: 54321 }); assert.deepEqual(SS.read(img), { ok: true, table: 9, viewSeat: 6, playing: true, revision: 54321 }, 'width ' + w);
    const k = (Math.floor(h * 0.99) * w + Math.floor(0.2 * w * 20.5 / 40)) * 4; for (let c = 0; c < 3; c++) img.data[k + c] = 255 - img.data[k + c];
    const y0 = Math.ceil(0.972 * h); for (let y = y0; y < h; y++) for (let x = Math.floor(0.2 * w * 20 / 40); x < Math.floor(0.2 * w * 21 / 40); x++) { const i = (y * w + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 255 - img.data[i]; }
    assert.equal(SS.read(img).ok, false, 'flipped cell detected at width ' + w); }
  const regions = PP.allRegions(PP.controlledProfile(2)).map((r) => r.box);
  for (const b of [SS.REGION, FD.WAGER_FIELD, FD.CONTROLS.allin]) assert.equal(regions.filter((r) => G.overlaps(r, b)).length, 0, JSON.stringify(b));
});

test('dealer: frames are the controlled renderer plus the strip; stale clicks, illegal controls and bad wagers change nothing; raise-by converts', () => {
  const frames = [], d = new FD.TableDealer({ table: 4, convention: 'raise-by', handGapMs: 0, send: (m) => frames.push(m), record: () => {} });
  d.onWindow({ type: 'ready', client: { x: 0, y: 0, w: 960, h: 600 } }); const f = frames[0], img = IC.decodePng(Buffer.from(f.png, 'base64')), st = SS.read(img);
  assert.equal(st.table, 4); assert.equal(st.viewSeat, d.t.actor); assert.equal(img.width, 960); assert.deepEqual(f.legal, { fold: true, check: false, call: true, raise: true, allin: true });
  const rev = d.rev; d.onWindow({ type: 'action', control: 'call', wager: '', rev: rev - 1 }); assert.equal(d.counts.staleClicks, 1); assert.equal(d.rev, rev);
  d.onWindow({ type: 'action', control: 'check', wager: '', rev }); assert.equal(d.counts.illegal, 1); assert.equal(d.rev, rev);
  d.onWindow({ type: 'action', control: 'raise', wager: '12abc', rev }); assert.equal(d.counts.wagerRejected, 1);
  d.onWindow({ type: 'action', control: 'raise', wager: '200', rev }); const a = d.accepted[d.accepted.length - 1]; assert.equal(a.type, 'raise'); assert.equal(a.amount, 300, 'raise BY 200 over a 100 bet = raise TO 300');
  d.onWindow({ type: 'mouse-down', x: 5, y: 5, control: 'table', enabled: true }); assert.equal(d.counts.downOutsideControls, 1);
  assert.equal(FD.CONVENTIONS.includes('raise-to') && FD.CONVENTIONS.includes('raise-by'), true);
});

test('controlled fixture C# and the shipped profile use the same control geometry; the fixture reports to an oracle, never to the decision path', () => {
  const cs = read('desktop/testtable/EightMaxTestTable.cs');
  for (const [k, b] of Object.entries({ ...FD.CONTROLS, wager: FD.WAGER_FIELD })) assert.ok(cs.includes('{ "' + k + '", new RectangleF(' + [b.x, b.y, b.w, b.h].map((v) => v.toFixed(2) + 'f').join(', ') + ') }'), k + ' geometry identical');
  const p = SP.fixtureProfile({ exeSha256: 'a'.repeat(64) }); assert.deepEqual(p.execution.amountField, FD.WAGER_FIELD); assert.deepEqual(p.execution.controls.allin, FD.CONTROLS.allin);
  for (const k of ['fold', 'check', 'call', 'raise']) assert.deepEqual(p.layout.controls[k], FD.CONTROLS[k]);
  const code = read('src/simulator-controls.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); assert.ok(!/fixture-dealer|oracle|TableDealer/.test(code), 'the controller never imports the dealer or reads the oracle');
  assert.ok(!/require\(.*fixture-dealer/.test(read('tools/simulator-benchmark-035.cjs').split('runCount')[0].replace(/oracle-table-/g, '')), 'benchmark grades from oracle files only after running');
});

test('launchers are CRLF, name 0.35.0 and existing tools; the host whitelists them and refuses the benchmark while it is running', () => {
  const host = read('desktop/DesktopHost.cs');
  for (const [tool, cmd, f] of [['input-selftest', 'RUN-INPUT-SELFTEST.cmd', null], ['input-acceptance', 'RUN-INPUT-ACCEPTANCE.cmd', 'input-acceptance-035.cjs'], ['test-tables', 'START-TEST-TABLES.cmd', 'test-table-035.cjs'], [null, 'RUN-SIMULATOR-BENCHMARK.cmd', 'simulator-benchmark-035.cjs'], [null, 'RUN-035-ACCEPTANCE.cmd', null]]) {
    const c = fs.readFileSync(path.join(root, cmd), 'latin1'); assert.ok(c.includes('\r\n') && !/[^\r]\n/.test(c), cmd + ' CRLF'); assert.match(c, /0\.35\.0/);
    if (f) { assert.ok(c.includes('tools\\' + f), cmd + ' runs ' + f); assert.ok(fs.existsSync(path.join(root, 'tools', f))); }
    if (tool) assert.ok(host.includes('{"' + tool + '","' + cmd + '"}'), tool + ' whitelisted');
  }
  assert.ok(host.includes('{"simulator-benchmark",null}') && host.includes('tool=="simulator-benchmark"'), 'benchmark needs the host closed (same port)');
  for (const r of ['/api/input/status', '/api/input/command', '/api/input/estop', '/api/input/restart', '/api/input/settings']) assert.ok(host.includes('r.Path=="' + r + '"'), r);
  assert.match(host, /inputDriver=input\.Installed/); assert.match(host, /try\{input\.Dispose\(\);\}catch\{\}/, 'host shutdown ends the driver');
  const broker = read('desktop/InputBroker.cs'); assert.match(broker, /KILL_ON_JOB_CLOSE/); assert.match(broker, /--parent-pid/); assert.match(broker, /Restart it from Simulator Controls/, 'no silent restart after a crash');
  for (const forbidden of ['hello', 'shutdown', 'virtual-user-move', 'virtual-hotkey']) assert.ok(!new RegExp('"' + forbidden + '"').test(broker.split('static readonly string[] Allowed')[1].split(';')[0]), forbidden + ' not forwardable');
  assert.match(read('windows/Collect-TestResults.ps1'), /'Acceptance-0\.35'/);
});

test('dashboard: every id the Simulator Controls UI uses exists; START.html inlines the 0.35 modules', () => {
  const dash = read('dashboard.html'), ui = read('src/simulator-controls-ui.js'), ids = [...new Set([...ui.matchAll(/\$\('(simc-[a-z0-9-]+)'\)|on\('(simc-[a-z0-9-]+)'/g)].map((m) => m[1] || m[2]))];
  assert.ok(ids.length > 30); for (const id of ids) if (!/^simc-set-/.test(id)) assert.ok(dash.includes('id="' + id + '"'), id);
  const mods = ['input-geometry.js', 'input-motion.js', 'windows-input-driver.js', 'input-scheduler.js', 'status-strip.js', 'fixture-dealer.js', 'simulator-profiles.js', 'simulator-controls.js', 'simulator-controls-ui.js'];
  for (const m of mods) { assert.ok(dash.includes('<script src="src/' + m + '"></script>'), m); assert.ok(read('tools/build.py').includes("'" + m + "'"), 'build.py inlines ' + m); }
  const i = dash.indexOf('id="simc-panel"'); assert.ok(i > 0 && i < dash.indexOf('</main>') || i < dash.indexOf('<footer>'), 'panel inside <main> (not under the sidebar)');
});

test('EightMax 5.1 is unchanged: native engine binary, vendored libraries and build id', () => {
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex');
  assert.equal(sha('native/mwcli.exe'), 'b3e675bfe2ae231e7d637de07886af6b511905d5225db96fe12ce2c3ccab2f72');
  assert.equal(require('../src/study-adapter.js').ENGINE.build, '7d08acc7eb4577ee'); assert.match(read('desktop/DesktopHost.cs'), /Build="7d08acc7eb4577ee"/);
  const prov = JSON.parse(read('vendor/eightmax-5.1/provenance.json')); assert.ok(prov);
  for (const f of fs.readdirSync(path.join(root, 'vendor/eightmax-5.1')).filter((x) => x.endsWith('.js'))) assert.ok(!read('vendor/eightmax-5.1/' + f).includes('0.35'), f + ' untouched by 0.35');
  for (const f of ['docs/SIMULATOR-CONTROLS.md']) assert.ok(fs.existsSync(path.join(root, f)), f);
});
