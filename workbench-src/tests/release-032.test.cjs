'use strict';
/* 0.32 release: Research panel views, research summary tool, dashboard/host/launcher consistency, deep-stack simulation with
 * per-street accounting (turn and river decisions reached), shared-memory scaling with 5 and 10 worker threads, release metadata. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process'), { Worker } = require('node:worker_threads');
const root = path.join(__dirname, '..'), read = (p) => fs.readFileSync(path.join(root, p), 'utf8'), V = require('../src/research032-view.js');

test('research view: preflop figures carry their kind; full-game exploitability is unavailable, never 0; never "GTO"', () => {
  assert.match(V.preflopView(null).headline, /No preflop research/);
  const p = V.preflopView({ available: true, source: 'release measurement', mode: 'Standard Research Study', runs: [{ variant: 'baseline', seed: 8, updates: 2000000, reachWeightedClassCoverage: 0.9594, reachWeightedComboCoverage: 0.89, statesWithNoRow: 10, decisionStates: 100, rangeSupportWithinLimit: 0.5366, rangeSupportCi95: [0.49, 0.58],
    perSeat: [{ position: 'BB (big blind)', classCoverage: 0.91, missingStates: 46 }], missingBranches: [{ path: 'r0000001', position: 'BB', reach: 0.01, classesStored: 150, classesInRange: 169 }], deviations: [{ position: 'UTG', gainBB: 0.0012, ci95: [0.0008, 0.0016], conditionalGainBB: 0.3, reach: 0.004, fallbackShare: 0.99 }, { position: 'BB', error: 'time limit' }] }] });
  assert.match(p.headline, /95\.9%/); assert.match(p.headline, /53\.7%/); assert.match(p.detail, /LOWER-BOUND/); assert.match(p.fullGame, /unavailable .*not zero/); assert.match(p.status, /^Not validated/);
  assert.match(p.deviations[0].gain, /\[/); assert.match(p.deviations[1].gain, /^unavailable/); assert.ok(!JSON.stringify(p).includes('GTO'));
});

test('research view: linked studies, coverage columns kept apart, memory and turn solver', () => {
  const l = V.linkedView({ available: true, byStreet: { 'turn heads-up': { records: 4, withLinkedContinuation: 3, linkedComplete: 2, validated: 2, unverified: 2, failed: 0 } }, note: 'n' });
  assert.match(l.headline, /2 of 4 .* 3 have linked/); assert.equal(l.rows[0].missing, 1);
  const col = (e, a) => ({ decisions: 100, exact: e, abstracted: 0, solvedOnDemand: a, unavailable: 100 - e - a, exactShare: e / 100, anyStrategyShare: (e + a) / 100, exactShareCi95: [0, 0.1], byStreet: { 'river heads-up': { decisions: 10, exact: 1, abstracted: 0, solvedOnDemand: 8, unavailable: 1 } } });
  const c = V.coverageView({ available: true, source: 's', outOfSampleExact: col(2, 0), outOfSampleWithOnDemandRivers: col(2, 13), outOfSampleWithOnDemandRiversTurnsAndApproximations: col(2, 20), baseline031: { outOfSampleExact: '9 of 410 (2.2%)' } });
  assert.equal(c.rows.length, 3); assert.match(c.headline, /2\.0% exact .* 22\.0% with every enabled source/); assert.equal(c.streets[0].onDemand, 8);
  const m = V.memoryView({ live: { totalBytes: 16e9, usedShare: 0.5, pressure: 'normal', thisProcessRssBytes: 5e7 }, comparison: { source: 'x', rows: [{ tables: 10, peakRssMiB: { '0.31': 4463, '0.32': 938 }, identicalDecisions: true }], sharedPreflop: { bytes: 263942784 } } });
  assert.match(m.headline, /4463 MB → 938 MB/); assert.equal(m.rows[0].saved, '3525 MB'); assert.match(m.detail, /252 MB shared/);
  assert.match(V.turnView({ available: true, rows: [{ ranges: 'narrow', menu: 'a', stacks: 'SPR 4', iterations: 100, solveMs: 3000, exploitabilityPctPot: 0.39, stopped: 'target-reached' }, { ranges: 'any', menu: 'a', stacks: 'x', error: 'memory' }] }).headline, /1 of 2/);
});

test('research summary tool writes the dashboard document from release reports without training anything', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'em032r-')), 'summary.json'), home = fs.mkdtempSync(path.join(os.tmpdir(), 'em032h-'));
  const r = cp.spawnSync(process.execPath, [path.join(root, 'tools/research-summary-032.cjs'), '--out=' + out, '--lib=' + path.join(home, 'nolib')], { encoding: 'utf8', env: { ...process.env, HOME: home, LOCALAPPDATA: home } });
  assert.equal(r.status, 0, r.stderr); const d = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(d.format, 'eightmax-research-summary'); assert.equal(d.appVersion, require('../src/engine.js').VERSION); assert.equal(d.library.available, false); assert.ok(d.memory.live.totalBytes > 0); assert.match(d.disclaimer, /Nothing here is a GTO certification/);
  for (const k of ['preflop', 'coverage', 'turnSolver']) if (d[k].available) assert.match(d[k].source, /release measurement|this computer/);
});

test('dashboard Research panel, host route and launch tools agree; launchers are CRLF and name the current version (0.35.0)', () => {
  const dash = read('dashboard.html'), host = read('desktop/DesktopHost.cs'), ui = read('src/research032-ui.js');
  for (const id of ['rs-nav', 'rs-panel', 'rs-pf-runs', 'rs-pf-seats', 'rs-pf-missing', 'rs-pf-dev', 'rs-lk-rows', 'rs-cv-rows', 'rs-cv-streets', 'rs-mem-rows', 'rs-ts-rows', 'rs-run-preflop', 'rs-train', 'rs-continue', 'rs-validate']) { assert.ok(dash.includes('id="' + id + '"'), id); assert.ok(ui.includes("'" + id + "'"), 'ui uses ' + id); }
  assert.ok(host.includes('r.Path=="/api/research/summary"')); assert.ok(ui.includes("'/api/research/summary'"));
  for (const [tool, cmd] of [['preflop-research', 'RUN-PREFLOP-RESEARCH.cmd'], ['turn-solver-check', 'RUN-TURN-SOLVER-CHECK.cmd'], ['memory-check', 'RUN-MEMORY-CHECK.cmd'], ['research-summary', 'REFRESH-RESEARCH-SUMMARY.cmd']]) {
    assert.ok(host.includes('{"' + tool + '","' + cmd + '"}'), tool); assert.ok(ui.includes("'" + tool + "'"), 'ui launches ' + tool); const c = fs.readFileSync(path.join(root, cmd), 'latin1'); assert.ok(c.includes('\r\n') && !/[^\r]\n/.test(c), cmd + ' uses CRLF'); assert.match(c, /0\.35\.0/);
    const m = /tools\\([\w.-]+\.cjs)/.exec(c); assert.ok(m && fs.existsSync(path.join(root, 'tools', m[1])), cmd + ' names an existing tool'); }
  // the preserved user controls (section 14 of the brief) are still present
  for (const id of ['start', 'stop', 'rs-train', 'rs-continue', 'rs-validate', 'rg-play', 'tr-nav']) assert.ok(dash.includes('id="' + id + '"'), id);
});

test('deep-stack simulation: fixed 100 bb stacks reach turns and rivers; every street is counted (no solver: all scripted, labelled)', async () => {
  const PW = require('../tools/pipeline-worker.cjs'), counts = {};
  for (const stacks of [15, 100]) { const r = await PW.runTables({ tables: [1, 2], hands: 6, seed: 77, stacks, collectActions: true }); counts[stacks] = {}; for (const a of r.actions) counts[stacks][a[0]] = (counts[stacks][a[0]] || 0) + 1;
    assert.equal(r.reports.reduce((n, x) => n + x.completed, 0), 12, stacks + ' bb: every hand completes'); assert.ok(r.actions.every((a) => a[3] !== 'solver'), 'no solver attached: nothing is attributed to it'); }
  assert.ok((counts[100].turn || 0) + (counts[100].river || 0) > (counts[15].turn || 0) + (counts[15].river || 0), 'deeper stacks reach later streets more often: ' + JSON.stringify(counts));
});

test('shared memory scales: 10 worker threads viewing one 96 MB SharedArrayBuffer add far less memory than 10 private copies', async () => {
  const run = async (shared, n) => { const sab = shared ? new SharedArrayBuffer(96 << 20) : null; const before = process.memoryUsage().rss; const ws = [];
    for (let i = 0; i < n; i++) ws.push(new Promise((res, rej) => { const w = new Worker(`const { workerData, parentPort } = require('node:worker_threads'); const b = workerData.sab || new ArrayBuffer(96 << 20); const v = new Uint8Array(b); for (let i = 0; i < v.length; i += 4096) v[i] = workerData.sab ? v[i] : 1; parentPort.postMessage(process.memoryUsage().rss); setTimeout(() => {}, 300);`, { eval: true, workerData: { sab } }); w.once('message', (rss) => { res(rss); w.terminate(); }); w.once('error', rej); }));
    const rss = Math.max(...(await Promise.all(ws))); return rss - before; };
  const s5 = await run(true, 5), s10 = await run(true, 10), c10 = await run(false, 10);
  assert.ok(s10 < c10 / 2, 'shared 10 workers +' + Math.round(s10 / 1048576) + ' MB vs private copies +' + Math.round(c10 / 1048576) + ' MB'); assert.ok(s10 - s5 < 5 * (96 << 20) / 2, 'adding 5 more sharing workers does not add 5 copies');
});

test('release metadata (0.32 rules, current release): version everywhere, honest component statuses, 0.32 reports present, solver build unchanged', () => {
  const v = require('../src/engine.js').VERSION; assert.equal(v, '0.35.0'); const comp = JSON.parse(read('desktop/COMPONENT-VERSIONS.json')); assert.equal(comp.appVersion, v);
  const ci = JSON.parse(read('evidence/windows-ci-runs.json'));
  for (const [f, c] of Object.entries(comp.components)) { assert.equal(c.status.validatedInWindowsCI, ci.runs.some((r) => r.executables[f] === c.sha256), f); assert.equal(c.status.executedOnWindows, ci.runs.some((r) => r.executables[f] === c.sha256) || (ci.targetHardware || []).some((t) => t.executables[f] === c.sha256), f + ': executed on Windows only with evidence for this exact file'); }   // 0.33: rebuilt files can now have Windows CI evidence
  for (const f of ['reports/0.32-memory-comparison.json', 'reports/0.32-abstraction-validation.json', 'reports/0.32-shared-cache-benchmark-linux.json']) { const d = JSON.parse(read(f)); assert.ok(d.format, f); }
  assert.equal(require('../src/study-adapter.js').ENGINE.build, '7d08acc7eb4577ee'); assert.match(read('windows-ci/README.md'), /Windows CI for 0\.35\.0/);   // 0.33: the README records the actual runs
});

test('0.31 defect fixed: worker threads opening a NEW strategy library at the same time never fail (marker written under the lock)', async () => {
  const code = `const L = require(${JSON.stringify(path.join(root, 'src/strategy-library.js'))}); const { workerData, parentPort } = require('node:worker_threads'); try { L.StrategyLibrary.open(workerData); parentPort.postMessage('ok'); } catch (e) { parentPort.postMessage('ERR ' + e.message); }`;
  let bad = []; for (let k = 0; k < 15; k++) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'em032race-')); const r = await Promise.all(Array.from({ length: 6 }, () => new Promise((res) => { const w = new Worker(code, { eval: true, workerData: d }); w.once('message', res); }))); bad = bad.concat(r.filter((x) => x !== 'ok')); assert.ok(fs.existsSync(path.join(d, 'LIBRARY.json'))); }
  assert.deepEqual(bad, []);
});

test('coverage accounting on unseen hands: exact, abstracted and on-demand are separate columns with Wilson 95% intervals', () => {
  const C = require('../src/coverage.js');
  const acts = [['flop', 2, 2500, 'solver', 'library-memory'], ['river', 2, 900, 'solver', 'solved-on-demand', null, 1, null, 'validated'], ['turn', 3, 900, 'solver', 'library-approximate', null, 1, null, 'validated'], ['turn', 2, 900, 'scripted', null, 'library-miss'], ['preflop', 8, 2500, 'solver']];
  const c = C.classify(acts); assert.equal(c.postflopDecisions, 4); assert.equal(c.exact, 1); assert.equal(c.solvedOnDemand, 1); assert.equal(c.abstracted, 1); assert.equal(c.unavailable, 1);
  assert.equal(c.exactShare, 0.25); assert.equal(c.anyStrategyShare, 0.75); assert.deepEqual(c.exactShareCi95, C.wilson(1, 4)); assert.ok(c.exactShareCi95[0] < 0.25 && c.exactShareCi95[1] > 0.25); assert.equal(c.validatedShare, 0.5);
  assert.equal(C.wilson(0, 0), null);
});

test('river strategy utilisation in a deep-stack simulation: heads-up rivers are solved on demand, validated and used (no native engine needed)', async () => {
  const PW = require('../tools/pipeline-worker.cjs'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em032u-'));
  const r = await PW.runTables({ tables: [1, 2], hands: 25, seed: 4127, stacks: 100, collectActions: true, solver: { kind: 'library-only', library: { dir, mode: 'decision', adaptive: true, inlineHeadsUpRiver: true, inlineRiverMaxMs: 5000, quality: { policy: 'research', use: 'simulation-experiment' } } } });
  const rivers = r.actions.filter((a) => a[0] === 'river'), used = rivers.filter((a) => a[3] === 'solver');
  assert.ok(rivers.length > 0, 'rivers are reached at 100 bb'); assert.ok(used.length > 0, 'some river decision used a solver strategy: ' + JSON.stringify(rivers.map((a) => [a[1], a[3], a[4], a[5]]).slice(0, 12)));
  for (const a of used) { assert.ok(['solved-on-demand', 'library-memory', 'library-disk', 'library-shared'].includes(a[4]), a[4]); assert.equal(a[8], 'validated'); assert.equal(a[1], 2); }
});
