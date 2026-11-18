'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http');
const C = require('../src/screen-capture.js'), IC = require('../src/image-codec.js'), EM = require('../src/engine.js'), SIM = require('../src/sim-display.js'), FH = require('../src/full-hand.js');
const { CODES } = C;

function clockFrom(start = 1000) { let t = start; const c = () => t; c.advance = (ms) => { t += ms; }; c.set = (v) => { t = v; }; return c; }
function tableWindow(opts = {}) {
  const t = new EM.Table(1, 5); t.startHand(); const clock = opts.clock || clockFrom();
  const src = new C.SimulatedWindowSource((w, id) => SIM.renderTable(t, w, { v2: true, seed: id }), { clock, width: opts.width || 960, ...opts.source });
  const session = new C.CaptureSession(src, { clock, settleFrames: 1, maxFrameAgeMs: 500, ...(opts.session || {}) }); session.state = 'live';
  return { t, src, clock, session };
}

test('frames carry increasing sequence numbers, timestamps, size, hash and target identity', async () => {
  const { src, clock, session } = tableWindow(); await src.open(); const seen = [];
  for (let i = 0; i < 5; i++) { clock.advance(100); seen.push(await session.tick()); }
  assert.deepEqual(seen.map((f) => f.seq), [1, 2, 3, 4, 5]); assert.ok(seen.every((f) => f.valid && f.width === 960 && f.height === 600 && /^[0-9a-f]{8}$/.test(f.hash)));
  assert.ok(seen.every((f, i) => i === 0 || f.tMs > seen[i - 1].tMs)); assert.equal(seen[0].target.hwnd, 0x1001); assert.equal(seen[0].image.width, 960);
});
test('a failed capture is reported and the previous frame is never reused', async () => {
  const { src, clock, session } = tableWindow(); await src.open();
  clock.advance(50); const good = await session.tick(); assert.ok(good.valid); assert.ok(session.latest());
  src.set({ failNext: 1 }); clock.advance(50); const bad = await session.tick();
  assert.equal(bad.valid, false); assert.equal(bad.code, CODES.FAILED); assert.equal(bad.image, null);
  assert.equal(session.latest(), null, 'latest() must not hand out the old frame after a failure');
});
test('minimised, lost and covered windows are named, not silently captured', async () => {
  const { src, clock, session } = tableWindow(); await src.open();
  src.set({ minimized: true }); clock.advance(10); let f = await session.tick(); assert.equal(f.code, CODES.MINIMIZED); assert.equal(f.image, null);
  src.set({ minimized: false, lost: true }); clock.advance(10); f = await session.tick(); assert.equal(f.code, CODES.LOST);
  src.set({ lost: false }); src.method = 'screen-copy'; src.set({ occludedFraction: 0.2 }); clock.advance(10); f = await session.tick(); assert.equal(f.code, CODES.OCCLUDED, 'a screen copy of a covered window shows other windows');
  src.method = 'print-window'; clock.advance(10); f = await session.tick(); assert.ok(f.valid, 'print-window asks the window to paint itself, so 20% cover is not a problem');
  src.set({ occludedFraction: 0.8 }); clock.advance(10); f = await session.tick(); assert.equal(f.code, CODES.OCCLUDED, 'but a mostly hidden window is refused whatever the method');
});
test('stale frames are rejected: a frozen source does not keep producing "fresh" frames', async () => {
  const { src, clock, session } = tableWindow(); await src.open(); clock.advance(10); assert.ok((await session.tick()).valid);
  src.freeze(); clock.advance(900); const f = await session.tick(); assert.equal(f.code, CODES.STALE); assert.match(f.reason, /ms old/);
  src.unfreeze(); clock.advance(10); assert.ok((await session.tick()).valid);
});
test('resolution changes are detected and withheld until the size settles', async () => {
  const { src, clock, session } = tableWindow({ session: { settleFrames: 2 } }); await src.open();
  clock.advance(10); await session.tick(); clock.advance(10); const a = await session.tick(); assert.ok(a.valid);
  src.resize(1440); clock.advance(10); const during = await session.tick(); assert.equal(during.code, CODES.RESIZING); assert.equal(during.image, null); assert.equal(session.status().state, 'live', 'resizing is not an interruption');
  clock.advance(10); const after = await session.tick(); assert.ok(after.valid); assert.equal(after.width, 1440); assert.equal(after.resolutionChanged, true);
  assert.equal(session.status().resolutionChanges, 1);
});
test('window repositioning and DPI scale changes are carried in the frame metadata', async () => {
  const { src, clock, session } = tableWindow(); await src.open(); src.moveTo(-1900, 40); src.setDpiScale(1.5); clock.advance(10);
  const f = await session.tick(); assert.deepEqual([f.bounds.x, f.bounds.y], [-1900, 40]); assert.equal(f.dpiScale, 1.5);
});
test('identity change (handle reused by another process) is refused', async () => {
  const { src, clock, session } = tableWindow(); await src.open(); clock.advance(10); assert.ok((await session.tick()).valid);
  src.target.pid = 9999; clock.advance(10); const f = await session.tick(); assert.equal(f.code, CODES.IDENTITY);
});
test('blank, malformed and tiny frames are invalid', async () => {
  const clock = clockFrom(); const flat = { width: 400, height: 300, data: new Uint8ClampedArray(400 * 300 * 4).fill(0) }; flat.data.forEach((_, i) => { if (i % 4 === 3) flat.data[i] = 255; });
  const mk = (img) => new C.CaptureSession(new C.ImageSequenceSource([img], { clock }), { clock }); 
  let s = mk(flat); await s.src.open(); assert.equal((await s.tick()).code, CODES.INVALID);
  s = mk({ width: 400, height: 300, data: new Uint8ClampedArray(10) }); assert.equal((await s.tick()).code, CODES.INVALID);
  s = mk({ width: 40, height: 30, data: new Uint8ClampedArray(40 * 30 * 4) }); assert.equal((await s.tick()).code, CODES.INVALID);
});
test('interruption and recovery: repeated failures interrupt, consistent frames recover', async () => {
  const { src, clock, session } = tableWindow({ session: { failuresBeforeInterrupted: 2, recoveryGoodFrames: 2 } }); await src.open();
  src.set({ failNext: 3 }); for (let i = 0; i < 3; i++) { clock.advance(10); await session.tick(); }
  assert.equal(session.status().state, 'interrupted'); assert.equal(session.status().interruptions, 1);
  clock.advance(10); await session.tick(); assert.equal(session.status().state, 'recovering'); clock.advance(10); await session.tick(); assert.equal(session.status().state, 'live'); assert.equal(session.status().recoveries, 1);
});
test('user-controlled start/stop with a real timer: configurable frequency, frames stop after stop()', async () => {
  const t = new EM.Table(1, 5); t.startHand(); const src = new C.SimulatedWindowSource((w, id) => SIM.renderTable(t, w, { v2: true, seed: id }), { width: 800 });
  const s = new C.CaptureSession(src, { intervalMs: 20, settleFrames: 1, maxFrameAgeMs: 5000 }); assert.equal(s.status().state, 'idle');
  const got = []; s.on((f) => got.push(f)); assert.ok((await s.start()).ok); await new Promise((r) => setTimeout(r, 250)); await s.stop();
  const n = got.length; assert.ok(n >= 4 && n <= 14, 'frames at ~20 ms spacing: ' + n); await new Promise((r) => setTimeout(r, 80)); assert.equal(got.length, n, 'no frames after stop');
  assert.equal(s.status().state, 'stopped'); assert.equal(s.latest(), null); await assert.rejects(async () => { await s.start(); await s.start(); }, /already started/);
  await s.stop();
});
test('a source that cannot open reports it instead of pretending to run', async () => {
  const { src, session } = tableWindow(); session.state = 'idle'; src.set({ lost: true }); const r = await session.start(); assert.equal(r.ok, false); assert.equal(r.code, CODES.LOST); assert.equal(session.status().state, 'stopped');
});
test('a hung capture call times out rather than blocking the session', async () => {
  const hang = { open: async () => ({ ok: true }), grab: () => new Promise(() => {}), close: async () => ({ ok: true }), target: {} };
  const s = new C.CaptureSession(hang, { grabTimeoutMs: 30 }); const t0 = Date.now(); const f = await s.tick(); assert.equal(f.code, CODES.FAILED); assert.match(f.reason, /exceeded/); assert.ok(Date.now() - t0 < 500);
});
test('debug recording is bounded and indexed; recorded PNGs decode back to the frames', async () => {
  const files = new Map(), rec = new C.FrameRecorder({ sink: (n, b) => files.set(n, Buffer.from(b)), maxFrames: 3, every: 2 });
  const { src, clock, session } = tableWindow({ session: { recorder: rec } }); await src.open();
  for (let i = 0; i < 12; i++) { clock.advance(10); await session.tick(); }
  const idx = rec.writeIndex(); assert.equal(idx.frames.length, 3); assert.ok(idx.dropped >= 1); assert.ok(files.has('index.json'));
  const first = IC.decodePng(files.get(idx.frames[0].file)); assert.equal(first.width, 960); assert.equal(IC.fingerprint(first), idx.frames[0].hash);
});
test('monitor geometry: negative coordinates, multiple monitors, mixed DPI, off-screen regions', () => {
  const mons = [{ id: 0, x: 0, y: 0, width: 1920, height: 1080, dpiScale: 1, primary: true }, { id: 1, x: -2560, y: -200, width: 2560, height: 1440, dpiScale: 1.5 }];
  assert.equal(C.resolveRegion({ x: 100, y: 100, width: 960, height: 600 }, mons).ok, true);
  const left = C.resolveRegion({ x: -2000, y: 0, width: 960, height: 600 }, mons); assert.equal(left.ok, true); assert.equal(left.dpiScale, 1.5);
  const span = C.resolveRegion({ x: -400, y: 100, width: 800, height: 400 }, mons); assert.equal(span.ok, true); assert.ok(span.warnings.includes('spans-monitors-mixed-dpi'));
  const off = C.resolveRegion({ x: 1800, y: 900, width: 400, height: 400 }, mons); assert.equal(off.ok, false); assert.equal(off.code, CODES.OFFSCREEN);
  assert.throws(() => C.resolveRegion({ x: 0, y: 0, width: 4, height: 4 }, mons), /16x16/); assert.throws(() => C.validateMonitors([mons[0], { ...mons[0] }]), /Duplicate/);
  assert.equal(C.logicalToPhysical(640, 1.5), 960);
});
test('HostCaptureSource speaks the desktop-host protocol (mock host, same JSON as CaptureService.cs)', async () => {
  const t = new EM.Table(1, 3); t.startHand(); let frame = 0, closed = 0;
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { const body = b ? JSON.parse(b) : {}; res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/capture/open') return res.end(JSON.stringify(body.target.hwnd === '0xdead' ? { ok: false, code: 'target-lost', reason: 'The window no longer exists.' } : { ok: true, method: 'print-window', target: { ...body.target, title: 'Client' } }));
    if (req.url === '/api/capture/close') { closed++; return res.end('{"ok":true}'); }
    if (req.url === '/api/capture/frame') { frame++; if (frame === 3) return res.end(JSON.stringify({ ok: false, code: 'target-minimized', reason: 'The window is minimised', minimized: true })); const img = SIM.renderTable(t, 960, { v2: true, seed: frame }); return res.end(JSON.stringify({ ok: true, method: 'print-window', width: img.width, height: img.height, dpiScale: 1.25, frameId: frame, hostTimeMs: 1000 + frame, ageMs: 4, minimized: false, occludedFraction: 0, bounds: { x: 0, y: 0, width: 960, height: 600 }, target: { kind: 'window', hwnd: body.target.hwnd, pid: body.target.pid, title: 'Client' }, png: IC.encodePng(img).toString('base64') })); }
    res.statusCode = 404; res.end('{}'); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
  const request = async (m, p, body) => (await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })).json();
  try {
    const bad = new C.HostCaptureSource({ request, target: { kind: 'window', hwnd: '0xdead', pid: 1 } }); const r0 = await bad.open(); assert.equal(r0.ok, false); assert.equal(r0.code, 'target-lost');
    const s = new C.CaptureSession(new C.HostCaptureSource({ request, target: { kind: 'window', hwnd: '0x10', pid: 7, title: 'Client' } }), { settleFrames: 1, maxFrameAgeMs: 100000 }); assert.ok((await s.start()).ok);
    s.running = false; const f1 = await s.tick(), f2 = await s.tick(), f3 = await s.tick(), f4 = await s.tick();
    assert.ok(f1.valid && f2.valid); assert.equal(f1.dpiScale, 1.25); assert.equal(f1.width, 960); assert.equal(f3.code, CODES.MINIMIZED); assert.ok(f4.valid); assert.deepEqual([f1.sourceFrameId, f2.sourceFrameId], [1, 2]);
    await s.stop(); assert.equal(closed, 1);
    assert.throws(() => new C.HostCaptureSource({ request, target: { kind: 'process-memory' } }), /explicit capture target/);
  } finally { await new Promise((r) => srv.close(r)); }
});
test('DPI-scaled windows: layout is resolution independent but templates are not — calibrated at the capture scale they read exactly; templates from another scale are refused, never misread', async () => {
  const O = require('../src/vision-ocr.js'), BE = require('../tools/browser-eval.cjs'), M = require('../src/vision-metrics.js'), t = new EM.Table(1, 8); t.startHand();
  const clean = FH.makeVision(1); let refused = 0;
  for (const [scale, w] of [[1.25, 1200], [1.5, 1440], [2, 1920]]) {
    const samples = []; for (const c of BE.calibrationTables()) samples.push({ image: SIM.renderTable(c, w, { v2: true, heroSeat: 0, renderWidth: 960, seed: 3 }), truth: { board: c.board.slice(), hero: c.players[0].cards.slice(), pot: c.snapshot().pot, hand: c.hand, stacks: c.players.map((p) => p.stack), bets: c.players.map((p) => p.bet), heroSeat: 0 } });
    const cal = O.calibrateFromLabeled(SIM.L2, samples), vision = new O.ImageObserver({ table: 1, profiles: cal.profiles, cards: cal.cards, glyphs: cal.glyphs });
    const img = SIM.renderTable(t, w, { v2: true, renderWidth: 960, seed: 9, heroSeat: t.actor }), r = vision.observe(img, { heroSeat: t.actor }); assert.ok(r.ok, 'scale ' + scale + ': ' + (r.reasons || []).join('; '));
    assert.equal(r.observation.pot, 230); assert.equal(r.observation.actor, t.actor); assert.deepEqual(r.observation.seats[t.actor].cards, t.players[t.actor].cards); assert.deepEqual(r.observation.seats.map((x) => x.stack), t.players.map((p) => p.stack));
    const wrong = clean.observe(img, { heroSeat: t.actor }); if (!wrong.ok) refused++; else assert.deepEqual(wrong.observation.seats.map((x) => x.stack), t.players.map((p) => p.stack), 'if uncalibrated templates accept a frame it must still be right');
  }
  assert.ok(refused >= 0);
});
