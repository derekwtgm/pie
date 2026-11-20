'use strict';
// 0.33 release: Solver research panel, host launch tools, launchers, research summary, view classifications, component statuses from
// evidence (Windows-built executables), checksum manifest, release metadata consistency.
const test = require('node:test'), assert = require('node:assert'), fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const root = path.join(__dirname, '..'), read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const V = require('../src/research033-view.js');

test('dashboard Solver research panel, host allow-list, launchers (CRLF, existing tools) and preserved user controls agree', () => {
  const dash = read('dashboard.html'), host = read('desktop/DesktopHost.cs'), ui = read('src/research033-ui.js');
  for (const id of ['r33-nav', 'r33-panel', 'r33-pf-rows', 'r33-pf-pos', 'r33-pf-gains', 'r33-pf-cmp', 'r33-cal-rows', 'r33-flop-rows', 'r33-mw-refs', 'r33-mw-cross', 'r33-cov-rows', 'r33-perf-rows', 'r33-run-modes', 'r33-run-flop', 'r33-run-mw', 'r33-train', 'r33-continue', 'r33-validate', 'r33-precompute', 'r33-ranges', 'r33-hardware', 'r33-selftest', 'r33-collect']) { assert.ok(dash.includes('id="' + id + '"'), id); assert.ok(ui.includes("'" + id + "'"), 'ui uses ' + id); }
  for (const [tool, cmd] of [['preflop-modes', 'RUN-PREFLOP-MODES.cmd'], ['flop-solver-check', 'RUN-FLOP-SOLVER-CHECK.cmd'], ['multiway-validation', 'RUN-MULTIWAY-VALIDATION.cmd'], ['research-summary', 'REFRESH-RESEARCH-SUMMARY.cmd']]) {
    assert.ok(host.includes('{"' + tool + '","' + cmd + '"}'), tool); assert.ok(ui.includes("'" + tool + "'"), 'ui launches ' + tool);
    const c = fs.readFileSync(path.join(root, cmd), 'latin1'); assert.ok(c.includes('\r\n') && !/[^\r]\n/.test(c), cmd + ' uses CRLF'); assert.match(c, /0\.33\.0/);
    const m = /tools\\([\w.-]+\.cjs)/.exec(c); assert.ok(m && fs.existsSync(path.join(root, 'tools', m[1])), cmd + ' names an existing tool'); }
  for (const id of ['start', 'stop', 'rs-train', 'rs-continue', 'rs-validate', 'rg-play', 'tr-nav', 'rs-nav']) assert.ok(dash.includes('id="' + id + '"'), 'preserved control ' + id);
  assert.ok(read('tools/build.py').includes("'research033-view.js','research033-ui.js'"), 'START.html inlines the 0.33 panel');
  assert.ok(read('START.html').includes('id="r33-panel"'), 'START.html was rebuilt with the panel');
});
test('Solver research views keep classifications: approximate modes explained, unresolved gains not called profitable, unavailable never 0', () => {
  const pf = V.preflopModesView({ available: true, source: 'release', modes: {}, fullGame: 'Eight-handed exploitability / NashConv: unavailable (not computed; never 0).', runs: [
    { mode: 'B169', seed: 8, updates: 2000000, accuracy: 'approximate (compact continuation: check-down)', peakRssMiB: 904, stateBytes: 310e6, updatesPerSecond: 6830, positions: [{ position: 'UTG', statesWithRows: 10, classCoverage: 0.5, firstInClasses: 169, firstInMissing: 0 }],
      gains: [{ position: 'BTN', gainBB: 0.01, ci95: [-0.01, 0.03] }, { position: 'SB', gainBB: 0.02, ci95: [0.01, 0.03] }, { position: 'BB', gainBB: null, error: 'timeout' }] }], comparisons: [] });
  assert.match(pf.explain.join(' '), /Approximate/); assert.match(pf.fullGame, /unavailable/); assert.ok(!/: 0(\.0+)? *$/.test(pf.fullGame));
  assert.strictEqual(pf.gains[0].verdict, 'not resolved (interval includes 0)'); assert.strictEqual(pf.gains[1].verdict, 'profitable deviation found'); assert.match(pf.gains[2].gain, /unavailable/);
  assert.doesNotMatch(JSON.stringify(pf), /\bGTO\b|\bsolved\b/i);
  const fl = V.flopView({ available: true, source: 'x', results: [{ board: 'As7d2h', ranges: 'n', menu: 'm', stacks: 's', iterations: 75, exploitabilityPctPot: 0.37, wallMs: 25000, memoryMiB: 79, meetsTarget: true, missingRows: 0 }, { board: 'Th9h4c', ranges: 'n', menu: 'm', stacks: 's', iterations: 75, exploitabilityPctPot: 0.37, wallMs: 1, memoryMiB: 1, meetsTarget: true, missingRows: 12 }, { board: 'x', ranges: 'w', error: 'memory-limit' }] });
  assert.match(fl.rows[0].status, /validated/); assert.match(fl.rows[1].status, /incomplete/); assert.match(fl.rows[2].status, /unavailable/);
  const mw = V.multiwayView({ available: true, source: 'x', references: [{ game: 'k', pass: true, measured: {} }], crossCheck: [{ updates: 20000, independentPctPot: 60.75, enginePctPot: 60.75, agree: true, missingRows: 5, meetsLimit: false }] });
  assert.match(mw.cross[0].status, /incomplete/); assert.strictEqual(mw.refs[0].result, 'matches the analytic value');
  assert.match(V.coverageView({ available: false, message: 'Not measured yet.' }).headline, /Not measured/);
});
test('research summary 0.33 keeps the 0.32 keys and adds the v033 block from release reports without training anything', () => {
  const out = path.join(require('node:os').tmpdir(), 'em-rs033-' + process.pid + '.json');
  const r = cp.spawnSync(process.execPath, [path.join(root, 'tools/research-summary-033.cjs'), '--release', '--out=' + out], { encoding: 'utf8', timeout: 300000 }); assert.strictEqual(r.status, 0, r.stderr);
  const d = JSON.parse(fs.readFileSync(out, 'utf8')); fs.rmSync(out);
  for (const k of ['preflop', 'coverage', 'memory', 'turnSolver']) assert.ok(k in d, '0.32 key ' + k);
  for (const k of ['preflopModes', 'calibration', 'flopSolver', 'multiway', 'coverage', 'performance']) assert.ok(k in d.v033, 'v033.' + k);
  assert.strictEqual(d.v033.multiway.available, true); assert.ok(d.v033.multiway.references.every((x) => x.pass !== false));
});
test('release metadata 0.33: component statuses come from evidence; the Windows-built executables carry the current version (0.35.0); the native engine is unchanged', () => {
  const comp = JSON.parse(read('desktop/COMPONENT-VERSIONS.json')), ev = JSON.parse(read('evidence/build-evidence.json')), ci = JSON.parse(read('evidence/windows-ci-runs.json'));
  assert.strictEqual(comp.appVersion, require('../src/engine.js').VERSION); assert.strictEqual(comp.appVersion, '0.35.0');
  assert.match(ev.buildHost, /^Windows/, 'built on Windows, not cross-compiled');
  for (const f of ['desktop/bin/EightMaxWorkbench.exe', 'desktop/bin/EightMaxCapture.exe', 'desktop/bin/EightMaxWgc.exe']) {
    const h = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'), c = comp.components[f];
    assert.strictEqual(c.sha256, h, f); assert.strictEqual(ev.outputs[f].sha256, h, f + ' built in the recorded Windows run'); assert.strictEqual(c.status.crossCompiled, false);
    assert.strictEqual(c.status.executedOnWindows, ci.runs.some((r) => r.executables[f] === h) || (ci.targetHardware || []).some((t) => t.executables[f] === h), f + ': executed only with evidence');
    const b = fs.readFileSync(path.join(root, f)); assert.ok(b.toString('utf16le').includes('0.35.0'), f + ' embeds 0.35.0');
  }
  assert.strictEqual(comp.components['native/mwcli.exe'].sha256, 'b3e675bfe2ae231e7d637de07886af6b511905d5225db96fe12ce2c3ccab2f72', 'EightMax 5.1 engine unchanged (compact modes are game definitions)');
  assert.strictEqual(require('../src/study-adapter.js').ENGINE.build, '7d08acc7eb4577ee');
  for (const f of ['reports/0.33-multiway-validation.json', 'reports/0.33-checkdown-calibration.json', 'reports/0.33-flop-solver-benchmark.json', 'reports/0.33-preflop-modes.json']) { const d = JSON.parse(read(f)); assert.ok(d.format, f); }
});
test('checksum manifest covers every shipped file and verifies', () => {
  const lines = read('SHA256SUMS.txt').trim().split('\n'), listed = new Map(lines.map((l) => { const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(l); assert.ok(m, l); return [m[2], m[1]]; }));
  const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name).split(path.sep).join('/')]));
  const files = walk('').map((f) => f.replace(/^\//, '')).filter((f) => f !== 'SHA256SUMS.txt');
  for (const f of files) assert.ok(listed.has(f), 'listed: ' + f);
  let n = 0; for (const [f, h] of listed) { if (!/\.(js|cjs|cmd|ps1|cs|json|md|txt|html)$/.test(f) && n > 50) continue; assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'), h, f); n++; }
});
test('strategy-library ranges command runs end to end and writes ranges-latest.json beside the library (0.33 Windows CI regression)', { skip: !(process.env.EIGHTMAX_TEST_CLI && fs.existsSync(process.env.EIGHTMAX_TEST_CLI)) && 'native EightMax CLI not available (set EIGHTMAX_TEST_CLI)' }, () => {
  const os = require('node:os'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em-rg033-')), lib = path.join(dir, 'lib'); fs.mkdirSync(lib);
  try {
    const r = cp.spawnSync(process.execPath, [path.join(root, 'tools/strategy-library.cjs'), 'ranges', '--hands=2', '--updates=20000', '--cache=' + path.join(dir, 'cache')], { encoding: 'utf8', timeout: 600000, env: { ...process.env, EIGHTMAX_STRATEGY_LIBRARY: lib } });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout); assert.doesNotMatch(r.stdout + r.stderr, /Unknown command/); assert.ok(fs.existsSync(path.join(dir, 'ranges-latest.json')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
