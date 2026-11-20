'use strict';
// 0.35.0: the screen -> recognition -> state -> decision -> scheduler -> input -> confirmation loop (src/simulator-controls.js)
// against an IN-PROCESS fake desktop host: capture returns the fixture dealer's real rendered frames, input commands are mapped
// onto the dealer's controls. This tests the controller's logic (gating, confirmation, pausing, cursor ownership, deadlines),
// not Windows input - that is tools/input-acceptance-035.cjs and tools/simulator-benchmark-035.cjs on Windows.
const test = require('node:test'), assert = require('node:assert/strict');
const SC = require('../src/simulator-controls.js'), SP = require('../src/simulator-profiles.js'), SCH = require('../src/input-scheduler.js'), FD = require('../src/fixture-dealer.js'), XA = require('../src/execution-adapters.js'), G = require('../src/input-geometry.js');
const TOKEN = 'a'.repeat(64), sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeHost(n, o = {}) {
  const tables = new Map(), stats = { inputConcurrent: 0, maxConcurrent: 0, clicks: 0, typed: 0, violations: [] };
  for (let i = 1; i <= n; i++) {
    const client = { x: 30 + i * 40, y: 20 + i * 30, w: 960, h: 600 }, t = { client, frame: null, field: '', hwnd: '0x' + (0x1000 * i).toString(16).toUpperCase() };
    t.dealer = new FD.TableDealer({ table: i, seed: 100 + i, handGapMs: 50, turnDelayMs: o.turnDelayMs || 0, send: (m) => { if (m.type === 'frame') t.frame = m; } });
    t.dealer.onWindow({ type: 'ready', client, hwnd: t.hwnd }); tables.set(t.hwnd, t);
  }
  const reply = (v) => ({ ok: true, status: 200, text: async () => JSON.stringify(v) });
  async function fetch(url, init) {
    const path = url.replace('http://127.0.0.1:48713', ''), body = init.body ? JSON.parse(init.body) : {};
    if (init.headers['X-EightMax-Session'] !== TOKEN) return { ok: false, status: 403, text: async () => '{"error":"session"}' };
    if (path === '/api/capture/open') return reply({ ok: true });
    if (path === '/api/capture/close') return reply({ ok: true });
    if (path === '/api/capture/frame') { const t = tables.get(body.target.hwnd); await sleep(2); const f = t.frame; return reply({ ok: true, width: f.w, height: f.h, png: f.png, bounds: { x: t.client.x, y: t.client.y, width: t.client.w, height: t.client.h }, title: 'EightMax Test Table ' + String(t.dealer.id).padStart(2, '0') + f.title, frameId: f.rev }); }
    if (path !== '/api/input/command') return reply({ ok: false, error: 'unknown' });
    const t = tables.get(body.hwnd);
    switch (body.cmd) {
      case 'arm': case 'disarm': case 'cancel-all': case 'status': return reply({ ok: true, stats: {} });
      case 'window-info': if (o.onWindowInfo) o.onWindowInfo(t); return reply({ ok: true, window: { hwnd: t.hwnd, client: t.client, minimized: false } });
      case 'move-click': case 'enter-text': {
        if (body.expectClient && !(body.expectClient.x === t.client.x && body.expectClient.w === t.client.w && body.expectClient.y === t.client.y)) return reply({ ok: false, code: 'layout-changed', error: 'moved' });
        stats.inputConcurrent++; stats.maxConcurrent = Math.max(stats.maxConcurrent, stats.inputConcurrent); await sleep(15); stats.inputConcurrent--;
        if (!G.validClient(t.client)) return reply({ ok: false, code: 'outside-window' });
        const nx = (body.to.x - t.client.x) / t.client.w, ny = (body.to.y - t.client.y) / t.client.h, hit = Object.entries({ ...FD.CONTROLS, wager: FD.WAGER_FIELD }).find(([, b]) => nx >= b.x && ny >= b.y && nx < b.x + b.w && ny < b.y + b.h);
        if (body.cmd === 'enter-text') { if (!hit || hit[0] !== 'wager') stats.violations.push('typed outside the wager field'); t.field = body.text; stats.typed++; return reply({ ok: true, verified: true, read: body.text, plannedMs: 5, actualMs: 6 }); }
        stats.clicks++; if (!hit) { stats.violations.push('click outside every control'); return reply({ ok: true, plannedMs: 5, actualMs: 6, clickedAt: body.to }); }
        if (!o.ignoreClicks) { let control = hit[0]; if (o.wrongControl && control === 'call') control = 'fold'; t.dealer.onWindow({ type: 'action', control, wager: t.field, rev: t.dealer.rev }); }
        return reply({ ok: true, plannedMs: 5, actualMs: 6, steps: 1, clickedAt: body.to });
      }
    }
    return reply({ ok: false, code: 'unknown-command', error: body.cmd });
  }
  return { tables, stats, fetch };
}
function build(host, o = {}) {
  const api = new SC.HostApi({ token: TOKEN, fetch: host.fetch }), session = SC.hostSession(api), sched = new SCH.InputScheduler({ maxQueue: 8 });
  const auth = SC.authorizations({ environment: 'fake-host-test', approvedBy: 'unit test', exeFileName: 'EightMaxTestTable.exe', exeSha256: 'c'.repeat(64) }), profile = SP.fixtureProfile({ exeSha256: 'c'.repeat(64) });
  const rec = new XA.DiagnosticsRecorder({ max: 5000 });
  const tables = [...host.tables.values()].map((t) => new SC.SimulatorTable({ id: t.dealer.id, window: { hwnd: t.hwnd, pid: 1, title: 'EightMax Test Table ' + String(t.dealer.id).padStart(2, '0'), client: t.client }, profile, api, session, scheduler: sched, qaAuthorization: auth.qa, recorder: rec, allowScripted: true, seed: 3, timing: { postClickSettleMs: 0 }, options: { decisionWindowMs: o.window || 10000, pollMs: 5, idlePollMs: 5, postActionTimeoutMs: o.ackMs || 800, ...(o.options || {}) } }));
  return { api, session, sched, tables, rec };
}
async function runUntil(tables, pred, ms) { const end = performance.now() + ms; await Promise.all(tables.map(async (t) => { while (!t.stopped && performance.now() < end && !pred(t)) { const r = await t.step(); if (r.kind === 'paused') break; if (r.kind !== 'acted') await sleep(5); } })); }

test('one table: every executed action is read back from the screen and matches what the table received', async () => {
  const host = fakeHost(1), b = build(host); const [t] = b.tables;
  await runUntil(b.tables, (x) => x.m.confirmed >= 14, 20000);
  const d = host.tables.values().next().value.dealer, conf = t.log.filter((e) => e.status === 'confirmed');
  assert.ok(conf.length >= 14, 'confirmed ' + conf.length + ' ' + JSON.stringify(t.log.slice(-3)));
  assert.equal(t.m.ambiguous + t.m.timedOut, 0); assert.equal(host.stats.violations.length, 0);
  const acc = d.accepted; for (let i = 0; i < conf.length; i++) { const c = conf[i], a = acc[i]; assert.equal(a.seat, c.seat); assert.equal(a.hand, c.hand); assert.equal(a.type, c.action.type); if (a.type === 'raise') assert.equal(a.amount, c.action.amount); }
  assert.equal(d.counts.staleClicks, 0, 'never clicked an old frame');
  assert.ok(b.rec.events.some((e) => e.stage === 'ack' && e.status === 'confirmed'), 'diagnostics record confirmations');
  assert.ok(t.log.every((e) => e.source === 'scripted-fallback'), 'decisions are labelled scripted');
});

test('while another player is to act the table shows no controls: the controller waits, and confirms from the very next frame', async () => {
  const host = fakeHost(1, { turnDelayMs: 400 }), b = build(host); const [t] = b.tables;
  await runUntil(b.tables, (x) => x.m.confirmed >= 4, 20000);
  const d = host.tables.values().next().value.dealer; assert.ok(t.m.confirmed >= 4); assert.equal(t.m.ambiguous + t.m.timedOut + t.m.rejected, 0);
  assert.equal(d.counts.illegal + d.counts.staleClicks + d.counts.downOnDisabled, 0, 'never clicked while controls were off');
  assert.ok(Math.max(...t.m.confirmMs) < 350, 'confirmation came from the hold frame, not after the turn delay: ' + t.m.confirmMs.map(Math.round));
});

test('three tables share one cursor: input never overlaps, every table progresses', async () => {
  const host = fakeHost(3, { turnDelayMs: 30 }), b = build(host);
  await runUntil(b.tables, (x) => x.m.confirmed >= 6, 25000);
  assert.equal(host.stats.maxConcurrent, 1, 'one input operation at a time'); for (const t of b.tables) assert.ok(t.m.confirmed >= 6, 'table ' + t.id + ' confirmed ' + t.m.confirmed);
  const m = b.sched.metrics(); assert.equal(m.started, m.completed + m.failed); assert.ok(m.peakQueue >= 1);
});

test('an ignored click is reported as REJECTED, the table pauses and the click is never repeated', async () => {
  const host = fakeHost(1, { ignoreClicks: true }), b = build(host, { ackMs: 300 }); const [t] = b.tables;
  await runUntil(b.tables, () => false, 4000);
  assert.equal(t.m.attempted, 1); assert.equal(t.m.rejected, 1); assert.ok(t.paused, 'paused'); assert.equal(host.stats.clicks, 1, 'exactly one click, no retry');
});

test('a different action than the one sent is AMBIGUOUS: the table pauses, nothing is re-sent', async () => {
  const host = fakeHost(1, { wrongControl: true }), b = build(host); const [t] = b.tables;
  await runUntil(b.tables, (x) => x.paused, 8000);
  assert.ok(t.paused, 'paused after ambiguity'); assert.equal(t.m.ambiguous, 1); const clicks = host.stats.clicks; await t.step(); assert.equal(host.stats.clicks, clicks, 'paused table sends nothing');
});

test('the window moved between reading and input: the click is refused and the next action needs a fresh reading', async () => {
  let moved = false; const host = fakeHost(1, { onWindowInfo: (t) => { if (!moved) { moved = true; t.client = { ...t.client, x: t.client.x + 25 }; } } }), b = build(host); const [t] = b.tables;
  const r1 = await t.step(); assert.equal(r1.kind, 'acted'); assert.equal(r1.entry.status, 'rejected'); assert.match(r1.entry.reason, /layout-changed|moved or was resized/);
  assert.equal(host.stats.clicks, 0, 'no click with stale coordinates');
  await runUntil(b.tables, (x) => x.m.confirmed >= 2, 8000); assert.ok(t.m.confirmed >= 2, 'continues after a fresh observation');
});

test('a decision that cannot be executed in time at the configured speed is refused, never rushed', async () => {
  const host = fakeHost(1), b = build(host, { window: 50 }); const [t] = b.tables; t.driver.motion = { ...t.driver.motion, maxSpeed: 60, maxAccel: 300, minDurationMs: 2000 };
  const r = await t.step(); assert.equal(r.entry.status, 'rejected'); assert.match(r.entry.reason, /deadline/); assert.equal(host.stats.clicks, 0);
});

test('scheduler: earliest deadline first, one table at a time, pause and emergency stop reject queued work', async () => {
  let now = 0; const s = new SCH.InputScheduler({ now: () => now, maxQueue: 3 }), order = []; let release;
  const block = new Promise((r) => { release = r; });
  const first = s.submit({ table: 1, deadline: 100, run: async () => { order.push(1); await block; return 'a'; } });
  const late = s.submit({ table: 2, deadline: 500, run: async () => { order.push(2); return 'b'; } }), early = s.submit({ table: 3, deadline: 200, run: async () => { order.push(3); return 'c'; } });
  assert.equal((await s.submit({ table: 1, deadline: 900, run: async () => 0 })).code, 'table-busy');
  release(); await Promise.all([first, late, early]); assert.deepEqual(order, [1, 3, 2]);
  now = 1000; assert.equal((await s.submit({ table: 4, deadline: 1100, estimateMs: 500, run: async () => 0 })).code, 'deadline');
  s.pauseTable(5, 'x'); assert.equal((await s.submit({ table: 5, deadline: 5000, run: async () => 0 })).code, 'paused');
  s.emergencyStop('test'); assert.equal((await s.submit({ table: 6, deadline: 5000, run: async () => 0 })).code, 'emergency-stop');
  s.reset(); assert.equal((await s.submit({ table: 6, deadline: 5000, run: async () => 7 })).result, 7);
  assert.equal((await s.submit({ table: 7, deadline: 5000, revalidate: async () => ({ ok: false, reason: 'hand changed' }), run: async () => 0 })).code, 'stale');
});

test('wager conversion: raise-to vs raise-by, chip units and limits are checked before anything is typed', () => {
  const ctx = { currentBet: 300, minRaiseTo: 500, maxRaiseTo: 2400, myBet: 100, myStack: 2300, canRaise: true };
  assert.deepEqual(XA.wagerText({ amount: 800, context: ctx }), { ok: true, text: '800', to: 800, convention: 'raise-to' });
  assert.equal(XA.wagerText({ amount: 800, context: ctx }, { amountConvention: 'raise-by' }).text, '500', 'raise-by types the chips above the current bet');
  assert.equal(XA.wagerText({ amount: 450, context: ctx }).ok, false, 'below minimum');
  assert.equal(XA.wagerText({ amount: 2400, context: ctx }).ok, true, 'all-in below the minimum is still legal (= max)');
  assert.equal(XA.wagerText({ amount: 2500, context: ctx }).ok, false, 'beyond the stack');
  assert.equal(XA.wagerText({ amount: 805, context: ctx }, { chipUnit: 25 }).ok, false, 'chip precision');
  assert.equal(XA.wagerText({ amount: 300, context: ctx }).ok, false, 'not above the current bet');
  assert.equal(XA.wagerText({ amount: 800, context: { ...ctx, canRaise: false } }).ok, false);
});

test('UI adapter: the idempotency key is taken before input, so a slow click can never be sent twice', async () => {
  const auth = SC.authorizations({ environment: 'unit', approvedBy: 'unit test', exeFileName: 'X.exe', exeSha256: 'd'.repeat(64) }).qa; let clicks = 0, release;
  const drv = { activate: async () => { clicks++; await new Promise((r) => { release = r; }); return { ok: true }; }, enterAmount: async () => ({ ok: true }) };
  const ctl = SP.fixtureProfile().layout.controls, a = new XA.UiAutomationAdapter({ authorization: auth, driver: drv, controls: ctl });
  const p1 = a.submit({ key: 'k', type: 'call', amount: 100 }); const r2 = await a.submit({ key: 'k', type: 'call', amount: 100 }); release(); await p1;
  assert.equal(clicks, 1); assert.equal(r2.accepted, false); assert.equal(a.noRetry, true);
});

test('calibration: regions convert at the current window size; overlaps, missing controls and unbound executables are reported', () => {
  const p = SP.fixtureProfile({ exeSha256: 'e'.repeat(64) }), r = SP.calibrationReport(p, { x: -1600, y: 100, w: 1440, h: 900 }, { dpiScale: 1.5 });
  assert.equal(r.ready, true, r.problems.join('; ')); assert.ok(r.confidence > 0.9); for (const k of ['fold', 'check', 'call', 'raise', 'allin', 'wager']) assert.ok(r.controls[k].point, k);
  const unbound = SP.calibrationReport(SP.fixtureProfile(), { x: 0, y: 0, w: 960, h: 600 }); assert.equal(unbound.ready, false); assert.match(unbound.problems.join(), /not bound/);
  assert.throws(() => SP.fromCalibration({ id: 'my-sim', name: 'x', regions: { fold: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } }, simulator: { exeFileName: 'S.exe', exeSha256: 'f'.repeat(64) } }), /check/);
  const regions = { fold: { x: 0.5, y: 0.9, w: 0.08, h: 0.05 }, check: { x: 0.55, y: 0.9, w: 0.08, h: 0.05 }, call: { x: 0.7, y: 0.9, w: 0.08, h: 0.05 }, raise: { x: 0.8, y: 0.9, w: 0.08, h: 0.05 }, wager: { x: 0.3, y: 0.9, w: 0.15, h: 0.05 } };
  const prof = SP.fromCalibration({ id: 'my-sim', name: 'My sim', regions, simulator: { exeFileName: 'S.exe', exeSha256: 'f'.repeat(64) } });
  assert.match(SP.calibrationReport(prof, { x: 0, y: 0, w: 1280, h: 800 }).problems.join(), /fold and check overlap/);
  const sug = SP.suggestFromUia([{ name: 'Fold', type: 'Button', box: { x: 100, y: 500, w: 80, h: 30 } }, { name: 'Wager amount', type: 'Edit', box: { x: 10, y: 500, w: 80, h: 30 } }], { x: 0, y: 0, w: 800, h: 600 });
  assert.ok(sug.fold && sug.wager);
});
