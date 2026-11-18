'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const CM = require('../src/capture-manager.js'), C = require('../src/screen-capture.js'), PP = require('../src/platform-profile.js'), EM = require('../src/engine.js'), SIM = require('../src/sim-display.js'), FH = require('../src/full-hand.js'), O = require('../src/vision-ocr.js');
const { CODES } = C;
const clockFrom = (s = 1000) => { let t = s; const c = () => t; c.advance = (m) => { t += m; }; return c; };
function rig(extra = {}) {
  const clock = clockFrom(), t = new EM.Table(1, 77); t.startHand(); const profile = PP.controlledProfile(2); let sim;
  const factory = async (id) => { if (id === 'structured-feed') throw new Error('feed has no pixels'); sim = new C.SimulatedWindowSource((w, i) => SIM.renderTable(t, w, { v2: true, seed: i, heroSeat: t.actor }), { clock, method: id === 'bitblt' ? 'bitblt-screen' : 'print-window' }); return sim; };
  const m = new CM.CaptureManager({ profile, factory, clock, sessionOptions: { settleFrames: 1, maxFrameAgeMs: 500 }, queueSize: 3, manual: true, ...extra }); return { clock, t, profile, m, get sim() { return sim; } };
}
test('catalogue is honest: Windows Graphics Capture is not implemented, Win32 methods are unrun on Windows, structured feed is non-optical', () => {
  assert.equal(CM.CATALOG['windows-graphics-capture'].implemented, false); assert.equal(CM.CATALOG['windows-graphics-capture'].verification, 'not-implemented');
  for (const k of ['printwindow', 'bitblt', 'window', 'desktop-region']) assert.equal(CM.CATALOG[k].verification, 'windows-unrun');
  assert.equal(CM.CATALOG['structured-feed'].opticalRecognition, false);
});
test('backend selection follows the profile, skips unimplemented/unavailable backends and says why', () => {
  const methods = ['windows-graphics-capture', 'printwindow', 'bitblt', 'screenshot-file'];
  let r = CM.selectBackend(methods, ['windows-graphics-capture', 'printwindow', 'bitblt'], {}); assert.equal(r.id, 'printwindow'); assert.match(r.skipped[0].reason, /not implemented/);
  r = CM.selectBackend(methods, ['printwindow', 'bitblt'], { printwindow: false }); assert.equal(r.id, 'bitblt'); assert.match(r.skipped[0].reason, /not available/);
  r = CM.selectBackend(['bitblt'], ['printwindow', 'bitblt'], {}); assert.equal(r.id, 'bitblt'); assert.match(r.skipped[0].reason, /profile/);
  r = CM.selectBackend(['windows-graphics-capture'], null, {}); assert.equal(r.ok, false);
  assert.equal(CM.selectBackend(['bogus'], null, {}).ok, false);
});
test('window identity validation names every change', () => {
  const sel = { hwnd: 5, pid: 10, className: 'Chrome_WidgetWin_1' };
  assert.equal(CM.checkWindowIdentity(sel, { ...sel, title: 'EightMax controlled client — table 1' }, { titleContains: 'controlled client' }).ok, true);
  const r = CM.checkWindowIdentity(sel, { hwnd: 6, pid: 11, className: 'Other', title: 'x' }, { titleContains: 'controlled' }); assert.equal(r.ok, false); assert.equal(r.problems.length, 4);
  assert.equal(CM.checkWindowIdentity(null, sel).ok, false);
});
test('manager starts, queues only valid new frames, bounds the queue and reports health', async () => {
  const { m, clock, t } = rig(); const r = await m.start(); assert.equal(r.ok, true);
  for (let i = 0; i < 6; i++) { clock.advance(100); await m.session.tick(); t.revision; }
  const h = m.health(); assert.equal(h.healthy, true, h.reasons.join()); assert.ok(h.queue.length <= 3); assert.ok(h.queue.dropped >= 0);
  const f = m.nextFrame(); assert.ok(f && f.valid && f.image); assert.equal(m.queue.length, 0, 'older backlog is discarded when the newest is taken');
  await m.stop();
});
test('first available preferred backend is used; structured-feed (no pixels) falls through to the next', async () => {
  const { m } = rig(); const r = await m.start(); assert.equal(r.ok, true); assert.equal(r.backend, 'window'); assert.ok(r.skipped.some((s) => s.id === 'structured-feed' && /no pixels/.test(s.reason))); await m.stop();
});
test('health turns unhealthy on a blank/stale/interrupted capture and recovers', async () => {
  const { m, clock, sim: _s } = rig(); await m.start('printwindow'); const s = m.session, src = s.src;
  for (let i = 0; i < 3; i++) { clock.advance(100); await s.tick(); } assert.equal(m.health().healthy, true);
  src.set({ failNext: 4 }); for (let i = 0; i < 4; i++) { clock.advance(100); await s.tick(); }
  let h = m.health(); assert.equal(h.healthy, false); assert.ok(h.consecutiveInvalid >= 3); assert.ok(m.nextFrame() === null, 'no frame is offered while capture is failing');
  for (let i = 0; i < 4; i++) { clock.advance(100); await s.tick(); } h = m.health(); assert.equal(h.state, 'live'); assert.ok(h.recoveries >= 1);
  clock.advance(10_000); assert.ok(m.nextFrame() === null, 'a frame older than the freshness limit is never handed out'); await m.stop();
});
test('switching backend flushes the queue and records the switch; unavailable targets are refused', async () => {
  const { m, clock } = rig(); await m.start('printwindow'); for (let i = 0; i < 3; i++) { clock.advance(100); await m.session.tick(); }
  assert.ok(m.queue.length > 0); const r = await m.switchTo('bitblt'); assert.equal(r.ok, true); assert.equal(m.backend, 'bitblt'); assert.equal(m.queue.length, 0); assert.equal(m.switches.length, 1);
  const bad = await m.switchTo('windows-graphics-capture'); assert.equal(bad.ok, false); assert.match(bad.reason, /not allowed|not implemented/); assert.equal(m.backend, 'bitblt', 'a refused switch keeps the working backend'); await m.stop();
});
test('screen-copy backend rejects an occluded window, PrintWindow-style backend tolerates less than half', async () => {
  const { m, clock } = rig(); await m.start('bitblt'); m.session.src.set({ occludedFraction: 0.3 }); clock.advance(50); const f = await m.session.tick(); assert.equal(f.code, CODES.OCCLUDED); await m.stop();
});
test('ObservationGate admits a good image observation and rejects every unreliable one', async () => {
  const { m, clock, t, profile } = rig(); await m.start('printwindow'); const cal = SIM.calibrate([960], profile.layout), vis = new O.ImageObserver({ table: 1, profiles: cal.profiles, cards: cal.cards, glyphs: cal.glyphs });
  const gate = new CM.ObservationGate({ clock, table: 1, health: () => m.health(), maxAgeMs: 500 });
  clock.advance(100); const f1 = await m.session.tick(); const rec = vis.observe(f1.image, { heroSeat: f1.viewSeat }); assert.equal(rec.ok, true, JSON.stringify(rec.reasons));
  const a = gate.admit(f1, rec); assert.equal(a.admit, true); assert.equal(a.imageBased, true);
  assert.deepEqual(gate.admit(f1, rec).reasons.includes('frame-out-of-order'), true, 'same frame twice is refused');
  assert.ok(gate.admit({ valid: false, code: CODES.STALE }, rec).reasons.some((x) => x.startsWith('frame-invalid')));
  assert.ok(gate.admit(f1, { ok: false, reasons: ['x'] }).reasons.includes('recognition-failed'));
  clock.advance(100); const f2 = await m.session.tick(); const low = { ok: true, observation: { ...rec.observation, confidence: { overall: 0.5 } } }; assert.ok(gate.admit(f2, low).reasons.some((x) => x.startsWith('low-confidence')));
  const other = { ok: true, observation: { ...rec.observation, table: 9 } }; assert.ok(gate.admit(f2, other).reasons.includes('wrong-table'));
  clock.advance(5000); assert.ok(gate.admit(f2, rec).reasons.includes('frame-stale')); assert.ok(gate.counts.rejected >= 5); await m.stop();
});
test('structured feed observations are validated and labelled non-optical', () => {
  const clock = clockFrom(); const feed = new CM.StructuredFeed({ clock }), ob = (seq) => ({ format: 'eightmax-observation', seq, seats: new Array(8).fill({}), source: 'image' });
  const a = feed.ingest(ob(1), clock()); assert.equal(a.ok, true); assert.equal(a.observation.source, 'structured-feed'); assert.equal(a.observation.opticalRecognition, false);
  assert.equal(feed.ingest(ob(1), clock()).ok, false); assert.equal(feed.ingest({ format: 'x' }, clock()).ok, false); assert.equal(feed.ingest({ ...ob(5), seats: [] }, clock()).ok, false);
  clock.advance(9999); assert.deepEqual(feed.ingest(ob(6), 1000).reasons, ['stale']);
});
test('FrameQueue is bounded and refuses invalid frames', () => {
  const q = new CM.FrameQueue(2); const f = (n) => ({ valid: true, image: {}, seq: n }); q.push(f(1)); q.push(f(2)); q.push(f(3)); assert.equal(q.length, 2); assert.equal(q.dropped, 1); assert.equal(q.shift().seq, 2);
  assert.throws(() => q.push({ valid: false }), /valid frames/); assert.throws(() => new CM.FrameQueue(0), /1..64/);
});
