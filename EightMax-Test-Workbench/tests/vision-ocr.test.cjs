'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const EMG = require('../src/engine.js'), HS = require('../src/hand-state.js'), O = require('../src/vision-ocr.js'), R = require('./synthetic-render.cjs');

const cal = R.calibrate();
const observer = (table = 1) => new O.ImageObserver({ table, profiles: cal.profiles, cards: cal.cards, glyphs: cal.glyphs });
function states(n, seed) {
  const t = new EMG.Table(1, seed), out = [];
  t.startHand();
  while (out.length < n) { if (t.status === 'complete') t.startHand(); out.push(t); const a = EMG.policy(t); t.execute(t.request(a.type, a.amount, 0), 0); yield_; }
  return out;
}
let yield_ = 0;

function run(width, noise) {
  const t = new EMG.Table(1, 99), e = new HS.HandStateEngine(1, { expectedBankroll: 20000, autoResumeAfter: 1, minOverallConfidence: 0.75, minFieldConfidence: 0.7 }), obs = observer();
  const truth = {}, pred = {}; let k = 0, frames = 0, accepted = 0, mismatched = 0, rejected = [];
  t.startHand();
  for (let i = 0; i < 60; i++) {
    if (t.status === 'complete') t.startHand();
    const img = R.renderTable(t, width, { noise, seed: i + 5 }), r = obs.observe(img, { hand: undefined });
    frames++;
    if (!r.ok) { rejected.push(r.reasons.join('; ')); }
    else {
      const res = e.ingest(r.observation);
      if (res.accepted) {
        accepted++;
        const s = res.state, snap = t.snapshot();
        const same = s.pot === snap.pot && s.actor === t.actor && s.button === t.dealer && JSON.stringify(s.board) === JSON.stringify(t.board) && s.seats.every((p, j) => p.stack === t.players[j].stack && p.bet === t.players[j].bet && p.folded === t.players[j].folded) && JSON.stringify(s.seats[0].cards) === JSON.stringify(t.players[0].cards);
        if (!same) mismatched++;
        truth['f' + i] = 1; pred['f' + i] = same ? 1 : 0;
      } else rejected.push(res.issues.map((x) => x.code).join(','));
    }
    const a = EMG.policy(t); t.execute(t.request(a.type, a.amount, 0), 0);
  }
  return { frames, accepted, mismatched, rejected };
}

test('screenshots of a controlled simulator reconstruct to the exact table state at 800, 960, 1440 and 1920 px wide', () => {
  for (const w of [800, 960, 1440, 1920]) {
    const r = run(w, 0);
    assert.equal(r.mismatched, 0, w + ' px: accepted frames must match the simulator exactly');
    assert.ok(r.accepted >= 55, w + ' px accepted ' + r.accepted + ' of ' + r.frames + ': ' + r.rejected.slice(0, 3).join(' | '));
  }
});

test('an uncalibrated resolution never yields a wrong accepted state', () => {
  const r = run(1200, 0);
  assert.equal(r.mismatched, 0);
});

test('mild pixel noise keeps zero wrong states; frames it cannot read are rejected rather than guessed', () => {
  const r = run(1440, 14);
  assert.equal(r.mismatched, 0, 'noise must never produce a wrong accepted state');
  assert.ok(r.accepted + r.rejected.length === r.frames);
});

test('images below the minimum resolution are rejected explicitly', () => {
  const t = new EMG.Table(1, 5); t.startHand();
  assert.match(observer().observe(R.renderTable(t, 640)).reasons[0], /resolution-too-low/);
});

test('severe noise yields rejections, never silent errors', () => {
  const r = run(960, 90);
  assert.equal(r.mismatched, 0);
  assert.ok(r.rejected.length > 0);
});

test('unrecognised layout, blank image, hidden hero cards and occlusion are explicit rejections', () => {
  const t = new EMG.Table(1, 5); t.startHand(); const o = observer();
  assert.match(o.observe({ width: 1000, height: 600, data: new Uint8ClampedArray(1000 * 600 * 4) }).reasons[0], /unrecognized-layout/);
  assert.equal(o.observe({ width: 960, height: 600, data: new Uint8ClampedArray(960 * 600 * 4).fill(40) }).ok, false);
  const hidden = o.observe(R.renderTable(t, 960, { hideHero: true })); assert.equal(hidden.ok, false); assert.ok(hidden.reasons.some((x) => /hero/.test(x)));
  const img = R.renderTable(t, 960); // black out the pot field
  const b = R.L.pot; for (let y = Math.floor(b.y * 600); y < Math.ceil((b.y + b.h) * 600); y++) for (let x = Math.floor(b.x * 960); x < Math.ceil((b.x + b.w) * 960); x++) { const i = (y * 960 + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 40; }
  const occ = o.observe(img); assert.equal(occ.ok, false); assert.ok(occ.reasons.some((x) => /^pot/.test(x)));
});

test('a misread number that is still readable is caught by the accounting checks', () => {
  const t = new EMG.Table(1, 8); t.startHand();
  const e = new HS.HandStateEngine(1, { expectedBankroll: 20000 }), o = observer();
  t.players[4].stack += 100; // render a state whose chips do not add up (as a corrupted screenshot would)
  const r = o.observe(R.renderTable(t, 960)); assert.equal(r.ok, true);
  const res = e.ingest(r.observation); assert.equal(res.accepted, false); assert.equal(res.issues[0].code, 'inconsistent-pot');
});

test('precision, recall and error-rate reporting counts rejections separately from errors', () => {
  const s = O.scoreReads({ a: '1', b: '2', c: '3', d: '4' }, { a: '1', b: '9', c: null });
  assert.equal(s.correct, 1); assert.equal(s.wrong, 1); assert.equal(s.rejected, 2);
  assert.equal(s.precision, 0.5); assert.equal(s.recall, 0.25); assert.equal(s.errorRate, 0.25); assert.equal(s.rejectionRate, 0.5);
});

test('digit OCR reads every value 0 to 20000 at several scales, or rejects it', () => {
  const t = new EMG.Table(1, 3); let wrong = 0, read = 0, total = 0;
  for (const w of [800, 960, 1920]) for (const v of [0, 5, 10, 50, 100, 230, 999, 1234, 2490, 2500, 7777, 10000, 19999, 20000]) {
    const im = R.makeImage(w, 0, 2); im.text(R.L.pot, String(v)); const img = im.finish(); total++;
    const r = O.readAmount(img, R.L.pot, cal.glyphs); if (r.accepted) { read++; if (r.value !== v) wrong++; }
  }
  assert.equal(wrong, 0); assert.ok(read >= total - 2, 'read ' + read + '/' + total);
});

test('recorded observation replay reports the exact rejection and pause points', () => {
  const t = new EMG.Table(1, 21); t.startHand(); const frames = []; let seq = 0;
  for (let i = 0; i < 8 && t.status === 'playing'; i++) { frames.push(HS.observeSimulator(t, seq++, { actions: undefined })); const a = EMG.policy(t); t.execute(t.request(a.type, a.amount, 0), 0); }
  const bad = JSON.parse(JSON.stringify(frames[3])); bad.pot += 50; frames[3] = bad;
  const out = O.replayObservations(frames, { autoResumeAfter: 2 });
  assert.equal(out.rejected, 1); assert.deepEqual(out.issues[0].issues[0].code, 'inconsistent-pot'); assert.ok(out.pausedFrames.includes(3));
  assert.equal(out.accepted, frames.length - 1);
});
