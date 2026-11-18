'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const PP = require('../src/platform-profile.js'), SIM = require('../src/sim-display.js'), O = require('../src/vision-ocr.js'), crypto = require('node:crypto');
const clone = (x) => JSON.parse(JSON.stringify(x));

test('pure-JS SHA-256 matches Node crypto (empty, short, multi-block, unicode)', () => {
  for (const s of ['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(1000), 'ünïcödé ♠♥']) assert.equal(PP.sha256(s), crypto.createHash('sha256').update(s, 'utf8').digest('hex'));
});
test('shipped sample profiles are valid, describe only the controlled renderer and name no external client', () => {
  const s = PP.SAMPLES(); assert.equal(s.length, 2);
  for (const p of s) { const v = PP.validateProfile(p); assert.equal(v.valid, true, v.issues.join()); assert.equal(p.verification.status, 'controlled-renderer'); assert.equal(p.verification.externalClient, null); assert.equal(p.execution.interface, 'internal-simulation'); }
  assert.deepEqual(PP.controlledProfile(2).layout, SIM.L2, 'v2 sample is exactly the renderer layout');
  assert.ok(PP.controlledProfile(2).structure.blinds.sb === 50 && PP.controlledProfile(2).structure.players === 8);
});
test('save/load round trip; any edit after saving is detected', () => {
  const p = PP.controlledProfile(2), text = PP.saveProfile(p), r = PP.loadProfile(text); assert.equal(r.ok, true); assert.deepEqual(r.profile, p);
  const tampered = JSON.parse(text); tampered.layout.pot.x += 0.01; const bad = PP.loadProfile(JSON.stringify(tampered)); assert.equal(bad.ok, false); assert.match(bad.problems.join(), /Checksum mismatch/);
  const unsigned = clone(p); assert.equal(PP.loadProfile(unsigned).ok, false); assert.equal(PP.loadProfile(unsigned, { allowUnsigned: true }).ok, true);
  assert.equal(PP.loadProfile('{not json').ok, false);
  const k = JSON.parse(text); const reordered = JSON.stringify(Object.fromEntries(Object.entries(k).reverse())); assert.equal(PP.loadProfile(reordered).ok, true, 'key order does not matter');
});
test('invalid profiles are rejected with reasons and cannot be saved', () => {
  const p = PP.controlledProfile(2);
  const cases = [
    [(q) => { q.format = 'x'; }, /format/], [(q) => { q.id = 'A'; }, /id must/], [(q) => { q.capture.methods = ['magic']; }, /unknown capture method/], [(q) => { q.capture.preferred = ['bitblt', 'windows-graphics-capture']; }, /preferred/],
    [(q) => { q.layout.pot = { x: 0.9, y: 0.9, w: 0.3, h: 0.3 }; }, /outside the image/], [(q) => { q.structure.players = 1; }, /players/], [(q) => { q.structure.blinds.sb = 0; }, /blinds/],
    [(q) => { q.execution.interface = 'press-buttons-on-some-site'; }, /execution.interface/], [(q) => { q.execution = { interface: 'test-server-api', requiresAuthorization: false }; }, /requiresAuthorization/],
    [(q) => { q.verification = { status: 'verified-by-operator', evidence: [] }; }, /evidence/], [(q) => { q.verification.externalClient = 'SomeSite'; }, /external client/], [(q) => { q.ocr.minConfidence = 0.2; }, /minConfidence/],
  ];
  for (const [mut, re] of cases) { const q = clone(p); mut(q); const v = PP.validateProfile(q); assert.equal(v.valid, false, String(re)); assert.match(v.issues.join(' | '), re); assert.throws(() => PP.saveProfile(q)); }
  assert.equal(PP.validateProfile(null).valid, false);
});
test('regions can be edited without touching the original; edited profiles drop their verified status', () => {
  const p = PP.controlledProfile(2), e = PP.setRegion(p, 'pot', { x: 0.43, y: 0.36, w: 0.12, h: 0.05 });
  assert.deepEqual(p.layout.pot, SIM.L2.pot); assert.equal(e.layout.pot.x, 0.43); assert.equal(e.verification.status, 'unverified');
  assert.throws(() => PP.setRegion(p, 'seats.9.stack', { x: 0, y: 0, w: 0.1, h: 0.1 }), /Unknown region/);
  assert.throws(() => PP.setRegion(p, 'pot', { x: 0.99, y: 0.5, w: 0.1, h: 0.1 }), /rejected/);
  assert.throws(() => PP.setRegion(p, 'pot', { x: NaN, y: 0, w: 0.1, h: 0.1 }), /numeric/);
  assert.throws(() => PP.setRegion(p, 'pot', { ...SIM.L2.seats[0].stack }), /overlaps/, 'an edit that makes two numeral boxes overlap is refused');
  const paths = PP.allRegions(p).map((r) => r.path); assert.ok(paths.includes('seats.7.allin') && paths.includes('controls.raise') && paths.includes('board.4'));
  for (const r of PP.allRegions(p)) assert.match(r.path, PP.REGION_PATHS);
});
test('template profile for a new platform is unverified, non-executable and valid', () => {
  const t = PP.templateProfile('my-new-test-table', 'My new table'); assert.equal(PP.validateProfile(t).valid, true); assert.equal(t.verification.status, 'unverified'); assert.equal(t.execution.interface, 'none'); assert.equal(t.verification.externalClient, null);
});
test('ProfileStore lists samples, saves and reloads through a text store, and refuses a damaged file', () => {
  const mem = new Map(), st = new PP.ProfileStore(mem); assert.equal(st.list().length, 2);
  st.add(PP.templateProfile('lab-table', 'Lab')); st.save('lab-table'); const st2 = new PP.ProfileStore(mem); assert.equal(st2.load('lab-table').id, 'lab-table');
  mem.set('lab-table', mem.get('lab-table').replace('"players": 8', '"players": 6')); assert.throws(() => st2.load('lab-table'), /rejected.*Checksum/);
  assert.throws(() => st.get('nope'), /No profile/);
});
test('a profile layout drives the existing image observer unchanged (profile -> recognition)', () => {
  const EM = require('../src/engine.js'), FH = require('../src/full-hand.js'); const t = new EM.Table(1, 33); t.startHand();
  const prof = PP.loadProfile(PP.saveProfile(PP.controlledProfile(2))).profile, cal = SIM.calibrate([960], prof.layout), vis = new O.ImageObserver({ table: 1, profiles: cal.profiles, cards: cal.cards, glyphs: cal.glyphs });
  const r = vis.observe(SIM.renderTable(t, 960, { v2: true, heroSeat: t.actor })); assert.equal(r.ok, true, JSON.stringify(r.reasons)); assert.equal(r.observation.layout.id, prof.layout.id);
});
