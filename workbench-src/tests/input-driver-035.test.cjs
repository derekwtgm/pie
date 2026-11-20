'use strict';
// 0.35.0: the REAL input driver code (desktop/input/*.cs) over its stdio protocol, on the in-memory virtual desktop.
// This exercises protocol, authentication, authorisation, identity/layout checks, motion, cancellation, emergency stop, manual
// override and key/button release WITHOUT moving anybody's cursor. It is NOT evidence that Windows input works; that is the
// Windows acceptance (tools/input-acceptance-035.cjs, windows/Test-Input.ps1) on a real desktop.
const test = require('node:test'), assert = require('node:assert/strict'), path = require('path'), os = require('os'), fs = require('fs');
const U = require('./input-util-035.cjs'), D = require('../src/windows-input-driver.js'), M = require('../src/input-motion.js'), G = require('../src/input-geometry.js');
let cmd; try { cmd = U.driverCommand(); } catch (e) { cmd = null; }
const skip = cmd ? false : 'needs desktop/bin/EightMaxInput.exe (Windows) or Mono mcs+mono (Linux)';

async function open(o = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em-vd-')), file = path.join(dir, 'desk.json'), desk = U.virtualDesktop(file, o);
  const t = D.spawnTransport({ exe: cmd.exe, args: [...cmd.pre, '--backend', 'virtual', '--virtual-desktop', file] }), s = new D.DriverSession(t, { timeoutMs: 15000 });
  await s.hello(); return { s, t, desk, close: () => s.close() };
}
const center = (w, name) => { const c = w.controls.find((k) => k.text === name || (name === 'edit' && /EDIT/.test(k.class))); return { x: c.box.x + (c.box.w >> 1), y: c.box.y + (c.box.h >> 1), region: c.box }; };

test('driver: wrong token is refused and the process ends; commands before hello are refused', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em-vd-')), file = path.join(dir, 'd.json'); U.virtualDesktop(file);
  const t = D.spawnTransport({ exe: cmd.exe, args: [...cmd.pre, '--backend', 'virtual', '--virtual-desktop', file] }), s = new D.DriverSession(t, { timeoutMs: 8000 });
  const before = await s.request('status'); assert.equal(before.code, 'not-authenticated');
  const r = await s.request('hello', { token: 'f'.repeat(64) }); assert.equal(r.ok, false); assert.equal(r.code, 'bad-token');
  await new Promise((res) => { if (t.exited) res(); else t.onExit(res); setTimeout(res, 5000); }); assert.ok(t.exited, 'driver exits after a wrong token');
});

test('driver: input needs arming, a registered window and an executable-bound authorization', { skip }, async () => {
  const x = await open(); try {
    const w = x.desk.windows[0], h = '0x' + w.hwnd.toString(16).toUpperCase(), p = center(w, 'fold');
    assert.equal((await x.s.request('move', { hwnd: h, to: p })).code, 'not-armed');
    await x.s.call('arm');
    assert.equal((await x.s.request('move', { hwnd: h, to: p })).code, 'target-not-registered');
    assert.equal((await x.s.request('register-target', { hwnd: h, authorization: U.authorization({ noRealMoney: false }) })).code, 'authorization-refused');
    assert.equal((await x.s.request('register-target', { hwnd: h, authorization: U.authorization({ expiresAtUnixMs: Date.now() + 9 * 3600e3 }) })).code, 'authorization-refused', 'more than 8 hours');
    assert.match((await x.s.request('register-target', { hwnd: h, authorization: U.authorization({ executable: { fileName: 'Other.exe', sha256: U.virtualSha(4000) } }) })).error, /not the authorised/);
    assert.match((await x.s.request('register-target', { hwnd: h, authorization: U.authorization({ executable: { fileName: 'EightMaxTestTable.exe', sha256: 'a'.repeat(64) } }) })).error, /SHA-256/);
    const ok = await x.s.call('register-target', { hwnd: h, authorization: U.authorization() }); assert.equal(ok.window.registered, true);
    const info = await x.s.call('window-info', { hwnd: h }); assert.deepEqual(info.window.client, w.client);
  } finally { await x.close(); }
});

test('driver: smooth movement follows the minimum-jerk plan, respects limits and ends exactly on target', { skip }, async () => {
  const x = await open(); try {
    const w = x.desk.windows[0], h = '0x' + w.hwnd.toString(16).toUpperCase(); await x.s.call('arm'); await x.s.call('register-target', { hwnd: h, authorization: U.authorization() });
    const p = center(w, 'raise'), motion = { maxSpeed: 1600, maxAccel: 9000, minDurationMs: 140, intervalMs: 16 };
    const r = await x.s.call('move', { hwnd: h, to: p, region: p.region, motion, expectClient: w.client });
    const plan = M.plan(r.from, r.to, M.profile(motion));
    assert.equal(r.steps, plan.steps); assert.ok(Math.abs(r.plannedMs - plan.durationMs) < 0.05, 'C# and JS plan the same duration');
    assert.deepEqual(r.samples.map((q) => [q.x, q.y]), plan.points.map((q) => [q.x, q.y]), 'C# and JS command the same pixels');
    assert.equal(r.finalError, 0); assert.ok(r.actualMs >= r.plannedMs - 2, 'never faster than planned');
    const c = M.commanded(r, M.profile(motion)); assert.equal(c.matchesPlan, true);
    const a = M.analyse(c.points, { profile: M.profile(motion), target: p, region: p.region }); assert.equal(a.ok, true, a.problems.join('; '));
    assert.ok(plan.peakSpeed <= 1600 + 1e-6 && plan.peakAccel <= 9000 + 1e-6, 'the analytic peaks are within the limits');
    const ev = (await x.s.call('virtual-events')).events.filter((e) => e.startsWith('move ')); assert.equal(ev.length, r.steps, 'one SendInput per step, no instantaneous jump');
  } finally { await x.close(); }
});

test('driver: move-click lands one click inside the region; stale layout, outside region and covering windows are refused', { skip }, async () => {
  const x = await open({ tables: 2, dx: 30, dy: 20 }); try {
    const [w1, w2] = x.desk.windows, h1 = '0x' + w1.hwnd.toString(16).toUpperCase(), h2 = '0x' + w2.hwnd.toString(16).toUpperCase(); await x.s.call('arm');
    for (const [h, pid] of [[h1, 4000], [h2, 4001]]) await x.s.call('register-target', { hwnd: h, authorization: U.authorization({ executable: { fileName: 'EightMaxTestTable.exe', sha256: U.virtualSha(pid) } }) });
    const p1 = center(w1, 'call');
    // window 2 lies on top of window 1 at window 1's call button: with focusPolicy refuse the click is refused ...
    const covered = await x.s.request('move-click', { hwnd: h1, to: p1, region: p1.region, expectClient: w1.client, focusPolicy: 'refuse' }); assert.equal(covered.code, 'target-covered');
    // ... with bring-to-front the driver raises window 1 first and the click lands on its button
    const r = await x.s.call('move-click', { hwnd: h1, to: p1, region: p1.region, expectClient: w1.client }); assert.equal(r.clicks, 1);
    let ev = (await x.s.call('virtual-events')).events; assert.equal(ev.filter((e) => e === 'click call').length, 1);
    const downs = ev.filter((e) => e.startsWith('down 0')).map((e) => e.split(' ').map(Number)); assert.equal(downs.length, 1);
    assert.ok(downs.every(([, , px, py]) => px >= p1.region.x && py >= p1.region.y && px < p1.region.x + p1.region.w && py < p1.region.y + p1.region.h), 'button pressed only inside the region');
    const stale = await x.s.request('move-click', { hwnd: h1, to: p1, region: p1.region, expectClient: { ...w1.client, w: w1.client.w + 1 } }); assert.equal(stale.code, 'layout-changed');
    const outside = await x.s.request('move', { hwnd: h1, to: { x: p1.region.x - 30, y: p1.y }, region: p1.region }); assert.equal(outside.code, 'outside-region');
    const off = await x.s.request('move', { hwnd: h1, to: { x: 5, y: 5 } }); assert.equal(off.code, 'outside-window');
    ev = (await x.s.call('virtual-events')).events; assert.equal(ev.filter((e) => e.startsWith('down')).length, 1, 'refusals pressed nothing');
    const dbl = await x.s.request('double-click', { hwnd: h1, region: p1.region }); assert.equal(dbl.code, 'double-click-not-authorized');
  } finally { await x.close(); }
});

test('driver: exact wager entry clears, types key by key and verifies; non-numeric text is refused', { skip }, async () => {
  const x = await open(); try {
    const w = x.desk.windows[0], h = '0x' + w.hwnd.toString(16).toUpperCase(); await x.s.call('arm'); await x.s.call('register-target', { hwnd: h, authorization: U.authorization() });
    const f = center(w, 'edit');
    const r = await x.s.call('enter-text', { hwnd: h, to: f, region: f.region, text: '1250', keyIntervalMs: 5, expectClient: w.client }); assert.equal(r.verified, true); assert.equal(r.read, '1250');
    const again = await x.s.call('enter-text', { hwnd: h, to: f, region: f.region, text: '300', keyIntervalMs: 5 }); assert.equal(again.read, '300', 'previous value cleared first');
    const ev = (await x.s.call('virtual-events')).events; assert.ok(ev.filter((e) => e === 'kdown 8').length >= 4, 'backspaces cleared the old text');
    assert.equal((await x.s.request('enter-text', { hwnd: h, to: f, region: f.region, text: '1e3' })).code, 'bad-request');
    const st = await x.s.call('status'); assert.equal(st.heldKeys, 0); assert.equal(st.heldButtons, false);
  } finally { await x.close(); }
});

test('driver: cancel stops a movement mid-way; nothing moves afterwards; emergency stop latches until reset', { skip }, async () => {
  const x = await open(); try {
    const w = x.desk.windows[0], h = '0x' + w.hwnd.toString(16).toUpperCase(); await x.s.call('arm'); await x.s.call('register-target', { hwnd: h, authorization: U.authorization() });
    const slow = { maxSpeed: 150, maxAccel: 1500, maxDurationMs: 20000 }, p = center(w, 'raise');
    const op = x.s.start('move', { hwnd: h, to: p, motion: slow }); await new Promise((r) => setTimeout(r, 300));
    await x.s.call('cancel', { op: op.id }); const r = await op.done; assert.equal(r.code, 'cancelled');
    const c1 = await x.s.call('cursor'); await new Promise((res) => setTimeout(res, 250)); const c2 = await x.s.call('cursor'); assert.deepEqual([c1.x, c1.y], [c2.x, c2.y], 'no movement after cancellation');
    assert.notDeepEqual([c1.x, c1.y], [p.x, p.y], 'stopped before the target');
    const op2 = x.s.start('move', { hwnd: h, to: { x: w.client.x + 20, y: w.client.y + 20 }, motion: slow }); await new Promise((res) => setTimeout(res, 200));
    await x.s.call('virtual-hotkey'); assert.equal((await op2.done).code, 'emergency-stop');
    assert.equal((await x.s.request('move', { hwnd: h, to: p })).code, 'emergency-stop', 'latched');
    assert.equal((await x.s.request('arm')).code, 'emergency-stop', 'cannot re-arm without reset');
    await x.s.call('reset-estop'); await x.s.call('arm'); await x.s.call('move', { hwnd: h, to: p, region: p.region });
  } finally { await x.close(); }
});

test('driver: a person moving the mouse makes automation yield until an explicit resume; the queue is bounded', { skip }, async () => {
  const x = await open(); try {
    const w = x.desk.windows[0], h = '0x' + w.hwnd.toString(16).toUpperCase(); await x.s.call('arm'); await x.s.call('register-target', { hwnd: h, authorization: U.authorization() });
    const p = center(w, 'fold'), op = x.s.start('move', { hwnd: h, to: p, motion: { maxSpeed: 150, maxAccel: 1500, maxDurationMs: 20000 } }); await new Promise((r) => setTimeout(r, 200));
    await x.s.call('virtual-user-move', { x: 900, y: 500 }); assert.equal((await op.done).code, 'manual-override');
    assert.equal((await x.s.request('move', { hwnd: h, to: p })).code, 'manual-override', 'does not fight the user');
    await x.s.call('resume'); await x.s.call('move', { hwnd: h, to: p, region: p.region });
    // between operations: the cursor is not where the driver left it -> yield
    await x.s.call('virtual-user-move', { x: 100, y: 900 }); assert.equal((await x.s.request('move', { hwnd: h, to: p })).code, 'manual-override');
    await x.s.call('resume');
    const ops = []; for (let i = 0; i < 12; i++) ops.push(x.s.request('move', { hwnd: h, to: i % 2 ? p : center(w, 'raise'), motion: { maxSpeed: 4000, maxAccel: 40000, minDurationMs: 30 } }));
    const res = await Promise.all(ops); assert.ok(res.some((r) => r.code === 'queue-full'), 'bounded queue refuses the overflow'); assert.ok(res.filter((r) => r.ok).length >= 8);
    await x.s.call('manual-mode', { on: true }); assert.equal((await x.s.request('move', { hwnd: h, to: p })).code, 'manual-mode'); await x.s.call('manual-mode', { on: false });
  } finally { await x.close(); }
});

test('geometry: normalised regions convert with the CURRENT client rectangle at 1080p, 1440p, 4K, 150 % and negative monitors', () => {
  const box = { x: 0.6, y: 0.93, w: 0.1, h: 0.05 };
  for (const c of [{ x: 0, y: 0, w: 1920, h: 1200 }, { x: 320, y: 90, w: 2560, h: 1600 }, { x: 0, y: 0, w: 3840, h: 2400 }, { x: -2560, y: -200, w: 1440, h: 900 }, { x: 1000, y: 500, w: 960, h: 600 }]) {
    const r = G.regionToScreen(box, c); assert.equal(r.ok, true);
    const x0 = c.x + box.x * c.w, x1 = x0 + box.w * c.w, y0 = c.y + box.y * c.h, y1 = y0 + box.h * c.h;
    assert.ok(r.rect.x >= x0 && r.rect.x + r.rect.w <= x1 && r.rect.y >= y0 && r.rect.y + r.rect.h <= y1, 'inset rectangle inside the control');
    assert.ok(r.point.x >= r.rect.x && r.point.x < r.rect.x + r.rect.w && r.point.y >= r.rect.y && r.point.y < r.rect.y + r.rect.h, 'click point inside');
  }
  // 150 %: a 960x600 logical client is 1440x900 physical; the same fraction lands at 1.5x the offset
  const a = G.regionToScreen(box, { x: 0, y: 0, w: 960, h: 600 }), b = G.regionToScreen(box, { x: 0, y: 0, w: G.logicalToPhysical(960, 1.5), h: G.logicalToPhysical(600, 1.5) });
  assert.ok(Math.abs(b.point.x - a.point.x * 1.5) <= 2 && Math.abs(b.point.y - a.point.y * 1.5) <= 2);
  assert.equal(G.regionToScreen({ x: 0.9, y: 0.9, w: 0.2, h: 0.05 }, { x: 0, y: 0, w: 960, h: 600 }).ok, false, 'region outside 0..1');
  assert.equal(G.regionToScreen({ x: 0.5, y: 0.5, w: 0.004, h: 0.004 }, { x: 0, y: 0, w: 960, h: 600 }).ok, false, 'too small to click');
  assert.equal(G.sameLayout({ x: 10, y: 20, width: 960, height: 600 }, { x: 10, y: 20, w: 960, h: 600 }), true); assert.equal(G.sameLayout({ x: 10, y: 20, width: 960, height: 600 }, { x: 11, y: 20, w: 960, h: 600 }), false);
  const mons = [{ bounds: { x: 0, y: 0, w: 3840, h: 2160 } }, { bounds: { x: -1920, y: 0, w: 1920, h: 1080 } }]; assert.equal(G.monitorAt(mons, { x: -5, y: 10 }), mons[1]);
});

test('motion: minimum-jerk plans never exceed speed/acceleration limits and are continuous; violations are detected', () => {
  const p = M.profile({ maxSpeed: 1600, maxAccel: 9000 });
  for (const d of [3, 40, 200, 900, 2500, 3800]) for (const arc of [0, 0.1, 0.25]) {
    const q = { ...p, arc }, pl = M.plan({ x: 0, y: 0 }, { x: d, y: d / 3 }, q);
    assert.ok(pl.peakSpeed <= q.maxSpeed * (1 + 1e-9) && pl.peakAccel <= q.maxAccel * (1 + 1e-9), 'analytic peaks within limits');
    // numerically from the continuous path (fine sampling): speed and acceleration also within limits
    let vmax = 0, amax = 0, prev = null, prevV = null; const T = pl.durationMs / 1000, N = 2000;
    for (let i = 0; i <= N; i++) { const t = T * i / N, P = M.at(0, 0, d, d / 3, i / N, arc); if (prev) { const v = Math.hypot(P.x - prev.x, P.y - prev.y) / (T / N); vmax = Math.max(vmax, v); if (prevV !== null) amax = Math.max(amax, Math.abs(v - prevV) / (T / N)); prevV = v; } prev = P; }
    assert.ok(vmax <= q.maxSpeed * 1.001, 'speed ' + vmax); if (arc === 0) assert.ok(amax <= q.maxAccel * 1.01, 'accel ' + amax);
    if (d > 0.5) assert.ok(pl.durationMs >= q.minDurationMs);
  }
  const jump = M.analyse([{ t: 0, x: 0, y: 0 }, { t: 16, x: 5, y: 0 }, { t: 32, x: 600, y: 0 }, { t: 48, x: 605, y: 0 }], { profile: p }); assert.equal(jump.ok, false); assert.match(jump.problems.join(), /discontinuity|speed/);
  const pl = M.plan({ x: 10, y: 10 }, { x: 900, y: 500 }, p), good = M.analyse([{ t: 0, x: 10, y: 10 }, ...pl.points], { profile: p, target: { x: 900, y: 500 }, region: { x: 880, y: 490, w: 40, h: 20 } }); assert.equal(good.ok, true, good.problems.join('; '));
  assert.equal(M.analyse([{ t: 0, x: 0, y: 0, down: true }, { t: 16, x: 1, y: 0 }], { expectNoButton: true }).ok, false);
  assert.equal(M.movedAfter([{ t: 0, x: 0, y: 0 }, { t: 10, x: 5, y: 0 }, { t: 20, x: 5, y: 0 }], 10).moved, false);
  assert.throws(() => M.profile({ maxSpeed: 1e9 }), /between/); assert.throws(() => M.profile({ teleport: 1 }), /Unknown/);
});
