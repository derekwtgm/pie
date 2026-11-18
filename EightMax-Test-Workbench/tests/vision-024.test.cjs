'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const EM = require('../src/engine.js'), O = require('../src/vision-ocr.js'), SIM = require('../src/sim-display.js'), M = require('../src/vision-metrics.js'), TRK = require('../src/vision-track.js'), HS = require('../src/hand-state.js'), FH = require('../src/full-hand.js'), IC = require('../src/image-codec.js');
const { engine } = require('./screen-util.cjs');
const { BrowserClient, browserAvailable } = require('../tools/browser-client.cjs'), BE = require('../tools/browser-eval.cjs');

const vision = (w) => FH.makeVision(1, w);
function playFrames(seed, hands, fn) { const t = new EM.Table(1, seed); for (let h = 0; h < hands; h++) { t.startHand(); for (let g = 0; g < 80; g++) { fn(t); if (t.status !== 'playing') break; const a = EM.policy(t); t.execute(t.request(a.type, a.amount, 0), 0); } } }

test('v2 layout reads hand id, all-in markers, action controls, call amount and minimum raise from pixels', () => {
  const t = new EM.Table(1, 8), v = vision(); t.startHand(); t.execute(t.request('raise', t.legal().maxRaiseTo, 0), 0); let sawAllIn = false, sawControls = 0;
  for (let g = 0; g < 80 && t.status === 'playing'; g++) {
    const hero = t.actor, img = SIM.renderTable(t, 960, { v2: true, heroSeat: hero }), r = v.observe(img, { heroSeat: hero }); assert.ok(r.ok, (r.reasons || []).join('; ')); const o = r.observation, l = t.legal();
    assert.equal(o.hand, t.hand); assert.equal(o.heroSeat, hero); assert.deepEqual(o.controls, { fold: l.toCall > 0, check: l.canCheck, call: l.toCall > 0, raise: l.canRaise }); sawControls++;
    if (l.toCall > 0) assert.equal(o.callAmount, l.callAmount); if (l.canRaise) assert.equal(o.minRaiseTo, Math.min(l.minRaiseTo, l.maxRaiseTo));
    o.seats.forEach((s, i) => { assert.equal(s.stack, t.players[i].stack); assert.equal(s.bet, t.players[i].bet); assert.equal(s.folded, t.players[i].folded); if (s.allInMarker) sawAllIn = true; assert.equal(s.allInMarker, t.players[i].stack === 0 && !t.players[i].folded); });
    assert.deepEqual(o.seats[hero].cards, t.players[hero].cards); assert.equal(o.seats.filter((s) => s.cards).length, 1, 'only the hero\'s cards are ever read');
    const a = EM.policy(t); t.execute(t.request(a.type, a.amount, 0), 0);
  }
  assert.ok(sawControls > 5 && sawAllIn, 'short stack went all-in and its marker was read');
});
test('hero-seat rotation: all eight views of one table decode to the same absolute state', () => {
  const t = new EM.Table(1, 15), v = vision(); t.startHand(); t.execute(t.request('raise', 300, 0), 0);
  for (let hero = 0; hero < 8; hero++) { const img = SIM.renderTable(t, 960, { v2: true, heroSeat: hero }), r = v.observe(img, { heroSeat: hero }); assert.ok(r.ok, hero + ': ' + (r.reasons || []).join(';')); assert.deepEqual(r.observation.seats.map((s) => s.stack), t.players.map((p) => p.stack)); assert.equal(r.observation.button, t.dealer); assert.equal(r.observation.actor, t.actor); assert.deepEqual(r.observation.seats[hero].cards, t.players[hero].cards); }
  assert.equal(v.observe(SIM.renderTable(t, 960, { v2: true, heroSeat: 0 }), { heroSeat: 9 }).ok, false);
});
test('synthetic accuracy is measured per category, with false-acceptance and rejection rates, and kept apart from other domains', () => {
  const mc = new M.MetricsCollector(), v = vision(), e = engine(); let seq = 0;
  playFrames(41, 6, (t) => { const hero = t.status === 'playing' ? t.actor : 0, truth = M.truthFromTable(t, hero), img = SIM.renderTable(t, 960, { v2: true, heroSeat: hero }), res = v.observe(img, { heroSeat: hero, seq: seq++ }); const eng = res.ok ? e.ingest(res.observation) : null; mc.add('synthetic', truth, res, eng); });
  const rep = mc.report(); const s = rep.domains.synthetic; assert.ok(s.frames > 80); assert.equal(s.falseAcceptances, 0); assert.equal(s.falseAcceptanceRate, 0); assert.equal(s.acceptedStateAccuracy, 1); assert.equal(s.rejectionRate, 0);
  for (const c of M.CATS) assert.equal(s.categories[c].accuracyOfRead, 1, c); assert.equal(s.categories.stack.fields, s.frames * 8);
  assert.match(rep.domains['real-client'].status, /not measured/); assert.equal(rep.domains['real-client'].frames, 0); assert.match(rep.domains['browser-render'].status, /not measured/);
  assert.throws(() => mc.add('imaginary', {}, {}, null), /Unknown domain/);
});
test('wrong readings are counted as wrong, not hidden: a corrupted number is a false acceptance only if the state engine accepts it', () => {
  const mc = new M.MetricsCollector(), t = new EM.Table(1, 3); t.startHand(); const truth = M.truthFromTable(t, t.actor), img = SIM.renderTable(t, 960, { v2: true, heroSeat: t.actor }), res = vision().observe(img, { heroSeat: t.actor });
  const bad = JSON.parse(JSON.stringify(res)); bad.observation.seats[4].stack = 2400; mc.add('synthetic', truth, bad, { accepted: true, issues: [] }); mc.add('synthetic', truth, bad, { accepted: false, issues: [{ code: 'inconsistent-stacks' }] }); mc.add('synthetic', truth, { ok: false, reasons: ['pot: unreadable'] }, null);
  const s = mc.report().domains.synthetic; assert.equal(s.falseAcceptances, 1); assert.equal(s.falseAcceptanceRate, 1); assert.equal(s.rejected, 2); assert.equal(s.rejectReasons['inconsistent-stacks'], 1); assert.ok(s.categories.stack.wrong === 2 && s.categories.stack.unread === 8);
});
test('misread numbers that are still readable are caught downstream by the rules (accounting + controls)', () => {
  const t = new EM.Table(1, 6), v = vision(), e = engine(); t.startHand(); const read = (seq) => { const r = v.observe(SIM.renderTable(t, 960, { v2: true, heroSeat: t.actor }), { heroSeat: t.actor, seq }); assert.ok(r.ok); return JSON.parse(JSON.stringify(r.observation)); };
  assert.ok(e.ingest(read(0)).accepted); t.execute(t.request('call', 0, 0), 0);
  const o = read(1); o.seats[5].stack = 2390; let x = e.ingest(o); assert.equal(x.accepted, false); assert.match(x.issues[0].code, /unexplained-change|inconsistent/); assert.equal(x.paused, true);
  const o2 = read(2); o2.callAmount = 90; x = e.ingest(o2); assert.equal(x.accepted, false); assert.equal(x.issues[0].code, 'controls-disagree');
  assert.ok(e.ingest(read(3)).accepted, 'the true reading is accepted afterwards (and two in a row resume the table)'); assert.equal(e.ingest(read(4)).paused, false);
});
test('conservative rejection is preserved: unreadable cards, blank regions, wrong layout and tiny images are refused with reasons', () => {
  const t = new EM.Table(1, 6), v = vision(); t.startHand(); const img = SIM.renderTable(t, 960, { v2: true, heroSeat: t.actor });
  const noisy = SIM.renderTable(t, 960, { v2: true, heroSeat: t.actor, noise: 110, seed: 3 }); const rn = v.observe(noisy, { heroSeat: t.actor }); assert.equal(rn.ok, false); assert.ok(rn.reasons.length >= 1);
  const hidden = SIM.renderTable(t, 960, { v2: true, heroSeat: t.actor, hideHero: true }); assert.equal(v.observe(hidden, { heroSeat: t.actor }).ok, false);
  assert.match(v.observe({ width: 960, height: 960, data: new Uint8ClampedArray(960 * 960 * 4) }, {}).reasons[0], /unrecognized-layout/); const small = SIM.renderTable(t, 640, { v2: true }); assert.match(v.observe(small, {}).reasons[0], /resolution-too-low/);
});
test('temporal filtering: stability gate and reading consensus withhold anything that is still changing', () => {
  const t = new EM.Table(1, 3); t.startHand(); const a = SIM.renderTable(t, 800, { v2: true, heroSeat: t.actor }), b = SIM.renderTable(t, 800, { v2: true, heroSeat: t.actor }); const gate = new TRK.StabilityGate({ required: 2 });
  assert.equal(gate.push(a).stable, false); assert.equal(gate.push(b).stable, true); t.execute(t.request('raise', 300, 0), 0); const c = SIM.renderTable(t, 800, { v2: true, heroSeat: t.actor }); const g3 = gate.push(c); assert.equal(g3.stable, false); assert.ok(g3.changedFraction > 0); assert.equal(gate.push(c).stable, true);
  assert.equal(TRK.changedFraction(a, SIM.renderTable(t, 640, { v2: true })), 1, 'a different size counts as fully changed');
  const v = vision(), cons = new TRK.ReadingConsensus({ required: 2 }), r1 = v.observe(c, { heroSeat: t.actor }).observation; assert.equal(cons.push(r1), null); assert.ok(cons.push(JSON.parse(JSON.stringify(r1)))); const alt = JSON.parse(JSON.stringify(r1)); alt.pot += 100; assert.equal(cons.push(alt), null);
});
test('custom OCR regions are validated before use: missing, off-image and overlapping numeral boxes are refused', () => {
  assert.deepEqual(O.validateLayout(SIM.L2), { valid: true, issues: [] }); assert.equal(O.validateLayout(O.defaultLayout()).valid, true);
  const bad = JSON.parse(JSON.stringify(SIM.L2)); bad.pot = { x: 0.95, y: 0.36, w: 0.12, h: 0.05 }; assert.match(O.validateLayout(bad).issues.join(), /pot is missing or outside/);
  const lap = JSON.parse(JSON.stringify(SIM.L2)); lap.handId = { ...lap.pot }; assert.match(O.validateLayout(lap).issues.join(), /overlaps/); const few = JSON.parse(JSON.stringify(SIM.L2)); few.board.pop(); assert.match(O.validateLayout(few).issues.join(), /five board/); assert.equal(O.validateLayout(null).valid, false);
});
test('operator calibration from labelled screenshots builds usable templates and reports what it skipped', () => {
  const samples = []; playFrames(77, 3, (t) => { const hero = t.status === 'playing' ? t.actor : 0; samples.push({ image: SIM.renderTable(t, 960, { v2: true, heroSeat: hero }), truth: M.truthFromTable(t, hero) }); });
  const cal = O.calibrateFromLabeled(SIM.L2, samples.map((s) => ({ image: s.image, truth: { ...s.truth, callAmount: s.truth.callAmount === null ? undefined : s.truth.callAmount, minRaise: s.truth.minRaise === null ? undefined : s.truth.minRaise } })));
  assert.ok(cal.stats.glyphs > 500 && cal.stats.cards > 40); const bad = O.calibrateFromLabeled(SIM.L2, [{ image: samples[0].image, truth: { ...samples[0].truth, pot: 99999999 } }]); assert.ok(bad.stats.skipped.some((x) => /pot/.test(x)), 'a label that disagrees with the glyph count is skipped, not forced');
});
test('genuine PNG files from the repository fixtures ingest through the codec and the observer rejects them cleanly (they are not poker tables)', () => {
  const fs = require('node:fs'), path = require('node:path'), dir = path.join(__dirname, '../examples/image-validation'), v = vision();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.png'))) { const img = IC.decodePng(fs.readFileSync(path.join(dir, f))); const r = v.observe(img, {}); assert.equal(r.ok, false, f); assert.ok(r.reasons.length >= 1); }
});

const SKIP_BROWSER = !browserAvailable() ? 'Chromium/Playwright is not installed here: browser-render recognition not measured in this run' : false;
test('REAL BROWSER RASTERISATION (Chromium): calibrate on labelled screenshots, read held-out play at several device pixel ratios, zero false acceptances', { skip: SKIP_BROWSER, timeout: 180000 }, async () => {
  const bc = await new BrowserClient().open();
  try {
    for (const dpr of [1, 1.5]) {
      const cal = await BE.calibrate(bc, dpr), ev = await BE.evaluate(bc, cal, dpr, 3, 900 + dpr), r = ev.report;
      assert.ok(cal.stats.cards > 100 && cal.stats.glyphs > 500); assert.equal(r.falseAcceptances, 0, 'dpr ' + dpr); assert.ok(r.readable / r.frames >= 0.9, 'dpr ' + dpr + ' readable ' + r.readable + '/' + r.frames); assert.equal(r.acceptedStateAccuracy, 1);
      for (const c of M.CATS) assert.ok(r.categories[c].accuracyOfRead === 1, 'dpr ' + dpr + ' ' + c);
    }
  } finally { await bc.close(); }
});
