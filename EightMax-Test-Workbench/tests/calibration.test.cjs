'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const CAL = require('../src/calibration.js'), PP = require('../src/platform-profile.js'), SIM = require('../src/sim-display.js'), EM = require('../src/engine.js'), O = require('../src/vision-ocr.js'), HS = require('../src/hand-state.js');

/** Labelled frames from the controlled renderer with an arbitrary layout; truth comes from the simulator (the oracle), pixels from the renderer. */
const M = require('../src/vision-metrics.js');
function frames(layout, width, seed, hands, opt = {}) {
  const out = [], t = new EM.Table(1, seed);
  for (let h = 0; h < hands; h++) {
    t.startHand();
    for (let g = 0; g < 80 && t.status === 'playing'; g++) {
      const hero = t.actor, truth = M.truthFromTable(t, hero);
      out.push({ image: SIM.renderTable(t, width, { v2: true, layout, heroSeat: hero, seed: out.length + 3, noise: opt.noise || 0 }), truth: { ...truth, heroSeat: hero, callAmount: truth.callAmount === null ? undefined : truth.callAmount, minRaise: truth.minRaise === null ? undefined : truth.minRaise } });
      const a = EM.policy(t); t.execute(t.request(a.type, a.amount, 0), 0);
    }
  }
  return out;
}

test('auto-detection is advisory: finds a table inside margins and card-like rectangles, and says when it is unsure', () => {
  const img = SIM.renderTable((() => { const t = new EM.Table(1, 4); t.startHand(); return t; })(), 960, { v2: true });
  const b = CAL.detectTableBounds(img); assert.equal(b.found, true); assert.ok(b.box.w > 0.5 && b.box.h > 0.5);
  const cards = CAL.detectCardCandidates(img); assert.ok(cards.length >= 2, 'hero cards are card-shaped light rectangles'); for (const c of cards) assert.ok(c.confidence <= 0.9);
  const flat = { width: 100, height: 100, data: new Uint8ClampedArray(100 * 100 * 4).fill(40) }; assert.equal(CAL.detectTableBounds(flat).found, false);
  const s = CAL.suggest(img, PP.controlledProfile(2)); assert.equal(s.ok, true); assert.equal(s.advisory, true); assert.equal(s.profile.verification.status, 'unverified'); assert.equal(s.profile.execution.interface, 'none'); assert.equal(PP.validateProfile(s.profile).valid, true, PP.validateProfile(s.profile).issues.join());
  assert.ok(s.notes.some((n) => /starting template/.test(n)));
});
test('learn on labelled frames, evaluate on held-out frames of the same layout: no false acceptance', () => {
  const prof = PP.controlledProfile(2), cs = new CAL.CalibrationSession(prof), train = frames(prof.layout, 960, 11, 4);
  for (const f of train) cs.addSample(f.image, f.truth); const rep = cs.learn(); assert.ok(rep.templatesGlyphs > 100); assert.ok(rep.templatesCards >= 20);
  const held = frames(prof.layout, 960, 99, 2), ev = cs.evaluate(held, { dataset: 'synthetic-heldout' });
  assert.equal(ev.falseAcceptances, 0, JSON.stringify(ev.categories)); assert.ok(ev.accepted / ev.frames > 0.4, 'accepts a useful share: ' + JSON.stringify({ a: ev.accepted, n: ev.frames })); assert.equal(ev.realClient, false); assert.equal(ev.dataset, 'synthetic-heldout');
});
test('an UNSEEN layout is read after editing regions + learning; the old profile rejects it rather than guessing', () => {
  const base = PP.controlledProfile(2), L2 = CAL.variantLayout(base.layout, { dx: 0.02, dy: -0.01, sx: 0.96, sy: 0.97, id: 'unseen-variant' });
  const newFrames = frames(L2, 960, 21, 4), heldNew = frames(L2, 960, 77, 2);
  // The old profile, calibrated for the old geometry, must not accept (or must read correctly) frames from the shifted table.
  const oldCs = new CAL.CalibrationSession(base); for (const f of frames(base.layout, 960, 5, 4)) oldCs.addSample(f.image, f.truth); oldCs.learn();
  const oldEv = oldCs.evaluate(heldNew); assert.equal(oldEv.falseAcceptances, 0, 'old geometry on new table: nothing wrong may be accepted'); assert.ok(oldEv.accepted < oldEv.frames);
  // Re-point every region (what the editor does) and re-learn from labelled new frames.
  let p = { ...base, layout: L2, id: 'unseen-variant-profile', name: 'variant', verification: { status: 'unverified', externalClient: null, evidence: [] } }; assert.equal(PP.validateProfile(p).valid, true, PP.validateProfile(p).issues.join());
  const cs = new CAL.CalibrationSession(p); for (const f of newFrames) cs.addSample(f.image, f.truth); cs.learn(); const ev = cs.evaluate(heldNew, { dataset: 'unseen-layout' });
  assert.equal(ev.falseAcceptances, 0); assert.ok(ev.accepted / ev.frames > 0.4, JSON.stringify({ a: ev.accepted, n: ev.frames }));
});
test('different resolutions need their own templates: unseen scale is rejected, calibrated scale is read', () => {
  const prof = PP.controlledProfile(2), cs = new CAL.CalibrationSession(prof); for (const f of frames(prof.layout, 960, 3, 4)) cs.addSample(f.image, f.truth); cs.learn();
  const at1440 = frames(prof.layout, 1440, 8, 1), ev = cs.evaluate(at1440, { dataset: 'resolution-1440-uncalibrated' }); assert.equal(ev.falseAcceptances, 0);
  const cs2 = new CAL.CalibrationSession(prof); for (const f of frames(prof.layout, 1440, 4, 4)) cs2.addSample(f.image, f.truth); cs2.learn(); const ev2 = cs2.evaluate(at1440, { dataset: 'resolution-1440-calibrated' }); assert.equal(ev2.falseAcceptances, 0); assert.ok(ev2.accepted >= ev.accepted);
});
test('exported bundle (profile + templates) reloads and reads the same frames identically; tampering is refused', () => {
  const prof = PP.controlledProfile(2), cs = new CAL.CalibrationSession(prof); for (const f of frames(prof.layout, 960, 2, 4)) cs.addSample(f.image, f.truth); cs.learn(); const bundle = cs.export();
  assert.equal(JSON.parse(bundle.profile).verification.status, 'unverified'); const re = CAL.CalibrationSession.import(JSON.parse(JSON.stringify(bundle))); const held = frames(prof.layout, 960, 55, 1);
  for (const f of held) { const a = cs.preview(f.image, { heroSeat: f.truth.heroSeat }), b = re.preview(f.image, { heroSeat: f.truth.heroSeat }); assert.equal(a.ok, b.ok); if (a.ok) assert.deepEqual(a.observation.seats.map((s) => s.stack), b.observation.seats.map((s) => s.stack)); }
  const bad = JSON.parse(JSON.stringify(bundle)); bad.profile = bad.profile.replace('"players": 8', '"players": 7'); assert.throws(() => CAL.CalibrationSession.import(bad), /rejected/);
  assert.throws(() => CAL.importTemplates({ format: 'x' }), /template/);
});
test('preview returns overlay regions and rejection reasons for an unreadable frame', () => {
  const prof = PP.controlledProfile(2), cs = new CAL.CalibrationSession(prof); for (const f of frames(prof.layout, 960, 6, 3)) cs.addSample(f.image, f.truth); cs.learn();
  const flat = { width: 960, height: 600, data: new Uint8ClampedArray(960 * 600 * 4).fill(60) }; for (let i = 3; i < flat.data.length; i += 4) flat.data[i] = 255; const p = cs.preview(flat); assert.equal(p.ok, false); assert.ok(p.reasons.length > 0); assert.ok(p.overlay.length > 50); assert.equal(p.confidence, 0);
  assert.throws(() => new CAL.CalibrationSession(prof).observer(), /learn/); assert.throws(() => new CAL.CalibrationSession(prof).learn(), /at least one/);
});
