'use strict';
/* 0.31 dashboard panels, host routes, launchers, Windows acceptance scripts and release metadata consistency. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..'), read = (p) => fs.readFileSync(path.join(root, p), 'utf8'), RV = require('../src/research-view.js');
let chromium = null; try { chromium = require('playwright').chromium; } catch (e) { chromium = null; }

test('strategy quality view: plain-language statuses, separate heads-up and multiway measures, never "GTO"', () => {
  assert.match(RV.qualityView(null).headline, /No accuracy check/);
  const v = RV.qualityView({ available: true, records: 3, byStatus: { validated: 1, unverified: 1, 'failed-quality-check': 1 }, policy: { name: 'research', headsUp: { maxExploitabilityPctPot: 1 }, multiway: { maxNashConvPctPot: 2.5 } }, writtenAt: '2026-11-19T01:00:00Z',
    rows: [{ situation: 'river AsKd7h4c2s', status: 'validated', measureKind: 'exploitability', measurePctPot: 0.42, players: 2, solver: '5.1 x', updates: 75, evaluatedAt: '2026-11-19' }, { situation: 'flop', status: 'unverified', players: 3 }] });
  assert.equal(v.headline, '1 of 3 stored strategies are validated'); assert.match(v.detail, /NashConv, a different measure/); assert.equal(v.rows[0].accuracy, 'exploitability 0.42% of the pot'); assert.equal(v.rows[1].accuracy, 'not measurable from the record');
  assert.equal(v.counts.length, 5); assert.ok(!JSON.stringify(v).includes('GTO'));
});

test('opponent range view: source, missing information and history per seat; 13x13 grid', () => {
  const h = { table: 2, hand: 7, conditionedStreets: ['flop'], byStreet: { preflop: {}, flop: {} }, notes: ['skip:turn', 'x'], seats: { 3: { provenance: 'derived-approximate-strategy', combos: 900, unsupported: [{ event: 'preflop Call', combos: 12, massShare: 0.02 }], top: [{ cls: 'AA', share: 0.01 }], history: [{ kind: 'card-removal' }, { kind: 'action', street: 'preflop', label: 'preflop Raise to 2.2', actionProbability: 0.1 }] } } };
  const v = RV.rangeHandView(h); assert.equal(v.title, 'Table 2, hand 7'); assert.equal(v.seats[0].history.length, 1); assert.match(v.seats[0].source, /NOT validated/); assert.match(v.seats[0].missing, /12 hands had no stored strategy/); assert.deepEqual(v.notes, ['x']);
  const g = RV.rangeGrid([{ cls: 'AA', avgWeight: 1 }, { cls: 'AKs', avgWeight: 0.5 }]); assert.equal(g.label(0, 0), 'AA'); assert.equal(g.label(0, 1), 'AKs'); assert.equal(g.label(1, 0), 'AKo'); assert.equal(g.grid[0][1], 0.5); assert.equal(g.grid[1][0], 0);
});

test('dashboard panels, host routes, launch tools and launchers agree (0.31)', () => {
  const html = read('START.html'); for (const id of ['sq-panel', 'sq-nav', 'sq-validate', 'sq-continue', 'rg-panel', 'rg-nav', 'rg-calc', 'tr-train', 'tr-continue', 'tr-validate', 'tr-common', 'tr-ranges', 'tr-save-workspace', 'tr-self-test', 'tr-long', 'tr-start-sim', 'tr-stop-sim', 'tr-load-strategy', 'tr-hardware', 'tr-collect', 'tr-emergency']) assert.ok(html.includes('id="' + id + '"'), id);
  assert.ok(html.includes('WorkbenchResearchView') && html.includes('WorkbenchRangeEngine')); assert.ok(!html.includes('<script src="src/'), 'START.html is self-contained');
  const host = read('desktop/DesktopHost.cs'); assert.match(host, /r\.Path=="\/api\/library\/quality"/); assert.match(host, /r\.Path=="\/api\/ranges\/latest"/); assert.match(host, /strategyQuality=true,opponentRanges=true/);
  for (const [tool, cmd] of [['library-validate', 'VALIDATE-STRATEGIES.cmd'], ['library-continue', 'CONTINUE-TRAINING.cmd'], ['library-precompute-common', 'PRECOMPUTE-COMMON-HANDS.cmd'], ['self-test', 'RUN-SELF-TEST.cmd'], ['long-acceptance', 'RUN-LONG-ACCEPTANCE.cmd'], ['view-ranges', 'VIEW-OPPONENT-RANGES.cmd']]) {
    assert.ok(host.includes('{"' + tool + '","' + cmd + '"}'), tool); const c = fs.readFileSync(path.join(root, cmd), 'latin1'); assert.ok(c.includes('\r\n') && !/[^\r]\n/.test(c), cmd + ' uses CRLF'); assert.match(c, /0\.35\.0/);
  }
  for (const t of ['tests\\range-engine-031.test.cjs', 'tests\\quality-031.test.cjs', 'tests\\library-031.test.cjs', 'tests\\abstraction-031.test.cjs']) { assert.ok(read('RUN-SELF-TEST.cmd').includes(t)); assert.ok(fs.existsSync(path.join(root, t.replace('\\', '/')))); }
  assert.ok(fs.existsSync(path.join(root, 'windows/Test-LongDuration.ps1'))); assert.match(read('windows/Collect-TestResults.ps1'), /'LongAcceptance'/);
});

test('release metadata: one version everywhere, honest component statuses, new reports and docs present', () => {
  const v = require('../src/engine.js').VERSION; assert.equal(v, '0.35.0');
  assert.match(read('windows/Common.ps1'), /\$WorkbenchVersion = '0\.35\.0'/); assert.match(read('desktop/DesktopHost.cs'), /Version="0\.35\.0"/); assert.match(read('desktop/wgc/EightMaxWgc.csproj'), /0\.35\.0/);
  const comp = JSON.parse(read('desktop/COMPONENT-VERSIONS.json')); assert.equal(comp.appVersion, v);
  for (const [f, c] of Object.entries(comp.components)) if (c.status.builtFromSourceForThisRelease) assert.equal(c.status.executedOnWindows, JSON.parse(read('evidence/windows-ci-runs.json')).runs.some((r) => r.executables[f] === c.sha256), f + ': a rebuilt file claims Windows execution only with matching evidence');
  for (const f of ['reports/0.31-training-variants.json', 'reports/0.31-abstraction-validation.json', 'reports/0.31-range-support.json']) { const d = JSON.parse(read(f)); assert.ok(d.format && d.generatedAt, f); }
  assert.match(require('../src/study-adapter.js').ENGINE.build, /^7d08acc7eb4577ee$/, 'EightMax 5.1 build unchanged');
});

test('Windows long-duration acceptance script parses and covers every listed workload', () => {
  const s = read('windows/Test-LongDuration.ps1');
  for (const k of ['benchmark-031.cjs', 'precompute', 'verify', 'quality', '--session', 'memory-samples.csv', 'mwcli', 'GPU-accelerated solver training', 'long-duration-targets.json', 'Collect-TestResults.ps1']) assert.ok(s.includes(k), k);
  assert.match(s, /'skip' 'Not available: the bundled EightMax 5\.1 native CLI trains on the CPU only/);
});

test('range calculator works in a real browser without the desktop host', { skip: !chromium && 'Playwright not installed' }, async () => {
  const b = await chromium.launch(); try {
    const p = await b.newPage(); await p.goto('file://' + path.join(root, 'START.html'));
    await p.click('#rg-nav'); await p.fill('#rg-calc-range', 'QQ+,AKs'); await p.fill('#rg-calc-dead', 'AsKd7h'); await p.click('#rg-calc');
    const st = await p.textContent('#rg-calc-status'); assert.match(st, /^14 possible hands/); assert.ok(await p.$$eval('#rg-calc-grid td', (t) => t.length) === 169);
    assert.match(await p.textContent('#rg-status'), /Not connected to the desktop host/);
    await p.click('#sq-nav'); assert.match(await p.textContent('#sq-status'), /Not connected to the desktop host/);
  } finally { await b.close(); }
});
