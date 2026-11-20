#!/usr/bin/env node
'use strict';
/* EightMax Test Workbench 0.35.0: WINDOWS INPUT ACCEPTANCE against the controlled test table (real cursor, real windows).
 *
 *   node tools/input-acceptance-035.cjs [--out reports/input-acceptance.json] [--oracle-dir DIR] [--quick]
 *
 * Starts the fixture (tools/test-table-035.cjs) and the input driver (desktop/bin/EightMaxInput.exe) directly, then runs the
 * scenarios below with VISIBLE input. Every check is graded from evidence that does not come from the driver itself: an
 * independent cursor sampler for movement, and the fixture's oracle (what the window actually received) for clicks and wagers.
 * The mouse and keyboard are used: do not touch them while it runs (touching them makes the driver yield, which is a FAIL here).
 */
const path = require('path'), fs = require('fs'), cp = require('child_process'), crypto = require('crypto'), os = require('os');
const ROOT = path.join(__dirname, '..');
const D = require(path.join(ROOT, 'src', 'windows-input-driver.js')), G = require(path.join(ROOT, 'src', 'input-geometry.js')), M = require(path.join(ROOT, 'src', 'input-motion.js')), FD = require(path.join(ROOT, 'src', 'fixture-dealer.js'));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : d; };
const OUT = arg('out', path.join(ROOT, 'reports', '0.35-input-acceptance.json')), ORACLE = arg('oracle-dir', path.join(os.tmpdir(), 'em-oracle-' + Date.now())), QUICK = process.argv.includes('--quick');
const BIN = path.join(ROOT, 'desktop', 'bin'), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], t0 = Date.now();
function check(name, ok, detail) { checks.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' - ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400) : '')); }

class Fixture {
  constructor(o) {
    this.child = cp.spawn(process.execPath, [path.join(ROOT, 'tools', 'test-table-035.cjs'), '--tables', String(o.tables || 1), '--width', String(o.width || 960), '--layout', o.layout || 'cascade', '--oracle-dir', o.oracleDir, '--convention', o.convention || 'raise-to', '--hand-gap', String(o.gap || 400), '--exe', path.join(BIN, 'EightMaxTestTable.exe')], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.buf = ''; this.waiters = []; this.msgs = []; this.seq = 0; this.oracleDir = o.oracleDir;
    this.child.stdout.setEncoding('utf8'); this.child.stdout.on('data', (d) => { this.buf += d; let k; while ((k = this.buf.indexOf('\n')) >= 0) { const l = this.buf.slice(0, k); this.buf = this.buf.slice(k + 1); try { const m = JSON.parse(l); this.msgs.push(m); for (const w of this.waiters.slice()) if (w.f(m)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.r(m); } } catch (e) { /* ignore */ } } });
  }
  wait(f, ms = 30000) { const hit = this.msgs.find(f); if (hit) { this.msgs.splice(this.msgs.indexOf(hit), 1); return Promise.resolve(hit); } return new Promise((r, j) => { const w = { f, r }; this.waiters.push(w); setTimeout(() => { const i = this.waiters.indexOf(w); if (i >= 0) { this.waiters.splice(i, 1); j(new Error('fixture timeout')); } }, ms); }); }
  async cmd(c) { const id = ++this.seq; this.child.stdin.write(JSON.stringify({ id, ...c }) + '\n'); return this.wait((m) => m.id === id); }
  async summary() { const r = await this.cmd({ cmd: 'summary' }); return r.tables; }
  oracle(table) { const f = path.join(this.oracleDir, 'oracle-table-' + String(table).padStart(2, '0') + '.jsonl'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; }
  async stop() { try { this.child.stdin.write(JSON.stringify({ cmd: 'stop' }) + '\n'); } catch (e) { /* gone */ } await sleep(1500); try { this.child.kill(); } catch (e) { /* gone */ } }
}
const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const authorization = () => ({ format: 'eightmax-simulator-authorization', version: 1, operatorOwnsSimulator: true, testEnvironmentOnly: true, noRealMoney: true, expiresAtUnixMs: Date.now() + 3600e3, executable: { fileName: 'EightMaxTestTable.exe', sha256: sha256File(path.join(BIN, 'EightMaxTestTable.exe')) } });
const inside = (p, r) => p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;

async function main() {
  const env = { platform: process.platform, node: process.version, host: os.hostname().replace(/./g, '*').slice(0, 4) };
  if (process.platform !== 'win32') { check('runs on Windows', false, 'this acceptance needs a Windows desktop'); return finish(env); }
  const tr = D.spawnTransport({ exe: path.join(BIN, 'EightMaxInput.exe') }), s = new D.DriverSession(tr, { timeoutMs: 30000 });
  const caps = await s.hello(); env.driver = { version: s.version, platform: s.platform, capabilities: caps };
  const mon = await s.call('monitors'); env.monitors = mon.monitors; env.virtualScreen = mon.virtualScreen;
  check('driver starts, authenticates and reports SendInput + DPI awareness', s.platform === 'win32' && caps.sendInput === true && /per-monitor/.test(caps.dpiAwareness), { dpi: caps.dpiAwareness, uia: caps.uiAutomation, hotkey: caps.hotkey, hotkeyRegistered: caps.hotkeyRegistered, rawInput: caps.rawInputOverride, note: caps.note });
  const fx = new Fixture({ tables: 2, layout: 'cascade', oracleDir: ORACLE }); const ready = await fx.wait((m) => m.type === 'ready');
  const [T1, T2] = ready.tables; env.fixture = ready.tables.map((t) => ({ table: t.table, client: t.client, dpi: t.dpi }));
  await s.call('arm');
  // ---- authorisation: an unregistered window is refused; registration binds to the executable hash ----
  const pre = await s.request('move', { hwnd: T1.hwnd, to: { x: T1.client.x + 50, y: T1.client.y + 50 } }); check('input to an unregistered window is refused', pre.code === 'target-not-registered', pre.code);
  const bad = await s.request('register-target', { hwnd: T1.hwnd, authorization: { ...authorization(), executable: { fileName: 'EightMaxTestTable.exe', sha256: 'b'.repeat(64) } } }); check('registration refused for a different executable hash', bad.code === 'authorization-refused', bad.error);
  for (const T of [T1, T2]) await s.call('register-target', { hwnd: T.hwnd, authorization: authorization(), label: 'table ' + T.table });
  const ident = await s.call('exe-identity', { hwnd: T1.hwnd }); check('driver hashes the target executable exactly like the file on disk', ident.exeSha256 === sha256File(path.join(BIN, 'EightMaxTestTable.exe')), ident.exeSha256);
  const uia = await s.call('uia-controls', { hwnd: T1.hwnd }); check('UI Automation lists the table buttons and the wager field', uia.available && ['Fold', 'Check', 'Call', 'Raise', 'All-in'].every((n) => uia.controls.some((c) => c.name === n)) && uia.controls.some((c) => c.type === 'Edit'), uia.controls.map((c) => c.name + ':' + c.type).join(', '));
  const info = async (T) => (await s.call('window-info', { hwnd: T.hwnd })).window;
  const target = async (T, ctl) => { const w = await info(T); return { w, ...G.regionToScreen(ctl === 'wager' ? FD.WAGER_FIELD : FD.CONTROLS[ctl], w.client) }; };
  const legalNow = async (T) => (await fx.summary()).find((x) => x.table === T.table);
  // Bring table 1 to the front for the first scenarios.
  await s.call('focus', { hwnd: T1.hwnd }); await sleep(300);

  // ---- 1. smooth visible movement across the window, sampled by an independent monitor ----
  { const w = await info(T1), a = { x: w.client.x + 30, y: w.client.y + 40 }, b = { x: w.client.x + w.client.w - 60, y: w.client.y + w.client.h - 50 };
    await s.call('move', { hwnd: T1.hwnd, to: a, expectClient: w.client }); await s.call('monitor-start', { intervalMs: 1 });
    const r = await s.call('move', { hwnd: T1.hwnd, to: b, expectClient: w.client }); await sleep(30); const mr = await s.call('monitor-stop');
    const samples = M.fromMonitor(mr.samples), moving = samples.filter((q, i) => i === 0 || q.x !== samples[i - 1].x || q.y !== samples[i - 1].y);
    const an = M.analyse(samples, { profile: M.DEFAULT_PROFILE, target: b, expectNoButton: true, dedupe: true, checkLimits: false });
    const cmdPath = M.commanded(r, M.DEFAULT_PROFILE), dr = M.analyse(cmdPath.points, { profile: M.DEFAULT_PROFILE, target: b }), timing = M.analyse([{ t: 0, x: r.from.x, y: r.from.y }, ...r.samples], { profile: M.DEFAULT_PROFILE, checkLimits: false });
    check('movement is continuous (independent 1 ms sampler: no step larger than max speed x update interval, no button down) and ends exactly on target', an.ok, { problems: an.problems, rawSamples: samples.length, positions: an.samples, travel: an.travel, maxStepPx: an.maxStepPx, stepLimitPx: an.stepLimitPx, targetError: an.targetError, buttonDownSamples: an.buttonDownSamples, measuredPeakSpeed: an.peakSpeed });
    check('commanded path follows the minimum-jerk plan and respects the speed and acceleration limits', cmdPath.matchesPlan && dr.ok, { matchesPlan: cmdPath.matchesPlan, peakSpeed: dr.peakSpeed, peakAccel: dr.peakAccel, limits: { maxSpeed: M.DEFAULT_PROFILE.maxSpeed, maxAccel: M.DEFAULT_PROFILE.maxAccel }, allowance: dr.allowance, problems: dr.problems });
    check('movement takes its planned time (not faster) at ~60 updates per second', r.actualMs >= r.plannedMs - 2 && timing.intervalMs.median >= 12 && timing.intervalMs.median <= 25, { plannedMs: r.plannedMs, actualMs: r.actualMs, medianIntervalMs: timing.intervalMs.median, maxIntervalMs: timing.intervalMs.max, maxTimingErrorMs: cmdPath.maxTimingErrorMs });
    env.movementSample = { independent: an, commanded: dr, timing: timing.intervalMs };
  }
  // ---- 2. click targeting: one click on the intended control, inside its region, accepted by the table ----
  { const before = await legalNow(T1); const t = await target(T1, 'call'); await s.call('monitor-start', { intervalMs: 2 });
    const r = await s.call('move-click', { hwnd: T1.hwnd, to: t.point, region: t.rect, expectClient: t.w.client }); await sleep(400); const mr = await s.call('monitor-stop');
    const after = await legalNow(T1), ev = fx.oracle(T1.table), downs = ev.filter((e) => e.kind === 'mouse-down'), acts = ev.filter((e) => e.kind === 'action');
    const lastDown = downs[downs.length - 1], cl = t.w.client, local = lastDown && { x: lastDown.x + cl.x, y: lastDown.y + cl.y };
    check('Call: exactly one press, on the Call button, inside the validated region', downs.length === 1 && lastDown.control === 'call' && inside(local, t.rect), { downs: downs.map((d) => d.control + '@' + d.x + ',' + d.y), region: t.rect, clickedAt: r.clickedAt });
    check('Call: the table accepted exactly one call', after.counts.accepted === before.counts.accepted + 1 && acts.length === 1 && acts[0].result === 'accepted' && acts[0].control === 'call', acts.map((a) => a.control + ':' + a.result));
    const pressDuringMove = M.fromMonitor(mr.samples).filter((q) => q.down).length; check('the button was down only for the click itself (no press while moving)', pressDuringMove >= 1 && pressDuringMove * 2 <= 200, pressDuringMove + ' samples (2 ms) with the button down');
  }
  // ---- 3. exact wager entry + raise; then an invalid wager is refused by the table and nothing changes ----
  { const st = (await legalNow(T1)); const raiseTo = 450; const f = await target(T1, 'wager');
    const er = await s.call('enter-text', { hwnd: T1.hwnd, to: f.point, region: f.rect, text: String(raiseTo), expectClient: f.w.client });
    check('wager typed key by key and read back exactly before submitting', er.verified === true && er.read === String(raiseTo), { read: er.read, field: er.field });
    const t = await target(T1, 'raise'); await s.call('move-click', { hwnd: T1.hwnd, to: t.point, region: t.rect, expectClient: t.w.client }); await sleep(400);
    const acts = fx.oracle(T1.table).filter((e) => e.kind === 'action'), last = acts[acts.length - 1];
    check('Raise: the table applied a raise to exactly the typed amount', last && last.result === 'accepted' && last.applied.type === 'raise' && last.applied.amount === raiseTo, last && { result: last.result, applied: last.applied, wager: last.wager, before: st.counts.accepted });
    const f2 = await target(T1, 'wager'); const er2 = await s.call('enter-text', { hwnd: T1.hwnd, to: f2.point, region: f2.rect, text: '5', expectClient: f2.w.client });
    const t2 = await target(T1, 'raise'); const sumBefore = await legalNow(T1); await s.call('move-click', { hwnd: T1.hwnd, to: t2.point, region: t2.rect, expectClient: t2.w.client }); await sleep(400);
    const sumAfter = await legalNow(T1), a2 = fx.oracle(T1.table).filter((e) => e.kind === 'action').pop();
    check('an invalid wager (below the minimum) is refused by the table and the state does not change', er2.read === '5' && a2.result === 'wager-rejected' && sumAfter.rev === sumBefore.rev && sumAfter.counts.accepted === sumBefore.counts.accepted, { result: a2.result, reason: a2.reason });
    const f3 = await target(T1, 'wager'); await s.call('enter-text', { hwnd: T1.hwnd, to: f3.point, region: f3.rect, text: '0', expectClient: f3.w.client });   // leave the field harmless
  }
  // ---- 4. window moved / resized: stale coordinates are refused; fresh ones land on the moved control ----
  { const old = await target(T1, 'fold'); await fx.cmd({ cmd: 'move', table: T1.table, x: 260, y: 140, w: 1120 }); await sleep(700);
    const stale = await s.request('move-click', { hwnd: T1.hwnd, to: old.point, region: old.rect, expectClient: old.w.client }); check('after the window moved and was resized, the old coordinates are refused (layout-changed)', stale.code === 'layout-changed', stale.code);
    const now = await target(T1, 'check'), before = fx.oracle(T1.table).filter((e) => e.kind === 'mouse-down').length;
    const leg = (await legalNow(T1)); const ctl = 'fold'; const t = await target(T1, ctl);
    await s.call('move-click', { hwnd: T1.hwnd, to: t.point, region: t.rect, expectClient: t.w.client }); await sleep(400);
    const downs = fx.oracle(T1.table).filter((e) => e.kind === 'mouse-down'); const d = downs[downs.length - 1];
    check('fresh coordinates after move+resize land on the intended control', downs.length === before + 1 && d.control === ctl, { control: d && d.control, client: t.w.client, rev: leg.rev, check: now.rect });
  }
  // ---- 5. covered window: refused with focusPolicy refuse, brought to front with the default policy ----
  { await fx.cmd({ cmd: 'move', table: T2.table, x: 240, y: 120, w: 1120 }); await s.call('focus', { hwnd: T2.hwnd }); await sleep(500);
    const t = await target(T1, 'wager'); const ref = await s.request('move-click', { hwnd: T1.hwnd, to: t.point, region: t.rect, expectClient: t.w.client, focusPolicy: 'refuse' });
    check('a click on a covered control is refused when bringing windows to the front is not allowed', ref.code === 'target-covered', ref.code);
    const b = fx.oracle(T1.table).filter((e) => e.kind === 'mouse-down').length, b2 = fx.oracle(T2.table).filter((e) => e.kind === 'mouse-down').length;
    const r = await s.call('move-click', { hwnd: T1.hwnd, to: t.point, region: t.rect, expectClient: t.w.client }); await sleep(300);
    const fg = await info(T1); const d1 = fx.oracle(T1.table).filter((e) => e.kind === 'mouse-down'), d2 = fx.oracle(T2.table).filter((e) => e.kind === 'mouse-down');
    check('with bring-to-front the covered window is raised first and only it receives the click', fg.foreground && d1.length === b + 1 && d2.length === b2 && d1[d1.length - 1].control === 'wager', { foreground: fg.foreground, t1: d1.length - b, t2: d2.length - b2, hit: r.hitClass });
  }
  // ---- 6. focus loss during typing is refused ----
  { const f = await target(T1, 'wager'); const op = s.request('enter-text', { hwnd: T1.hwnd, to: f.point, region: f.rect, text: '123456789', keyIntervalMs: 250, expectClient: f.w.client });
    await sleep(1400); await fx.cmd({ cmd: 'activate', table: T2.table }); const r = await op;
    check('keyboard entry stops when the simulator loses focus (no keys typed into another window)', !r.ok && ['focus-lost', 'verify-mismatch', 'field-not-focused'].includes(r.code), r.code + ': ' + (r.error || ''));
    const k2 = fx.oracle(T2.table).filter((e) => e.kind === 'key').length; check('the other window received no keystrokes', k2 === 0, k2 + ' keys');
  }
  // ---- 7. cancellation mid-movement ----
  { await s.call('focus', { hwnd: T1.hwnd }); await sleep(300); const w = await info(T1); await s.call('move', { hwnd: T1.hwnd, to: { x: w.client.x + 20, y: w.client.y + 20 }, expectClient: w.client });
    const op = s.start('move', { hwnd: T1.hwnd, to: { x: w.client.x + w.client.w - 30, y: w.client.y + w.client.h - 30 }, motion: { maxSpeed: 300, maxAccel: 2000, maxDurationMs: 20000 }, expectClient: w.client }); await sleep(400);
    await s.call('monitor-start', { intervalMs: 2 }); const tc = Date.now(); await s.call('cancel', { op: op.id }); const r = await op.done; await sleep(400); const mr = await s.call('monitor-stop');
    const sm = M.fromMonitor(mr.samples), after = M.movedAfter(sm, sm.length ? sm[sm.length - 1].t - 300 : 0);
    check('cancel interrupts a movement; the cursor does not move afterwards', r.code === 'cancelled' && !after.moved, { code: r.code, maxDisplacementAfter: after.maxDisplacement, cancelMs: Date.now() - tc });
  }
  // ---- 8. minimised and closed windows ----
  { await fx.cmd({ cmd: 'minimize', table: T2.table }); await sleep(600); const t = await s.request('move', { hwnd: T2.hwnd, to: { x: 100, y: 100 } });
    check('a minimised simulator window is refused', t.code === 'window-minimized', t.code); await fx.cmd({ cmd: 'restore', table: T2.table }); await sleep(500);
    await fx.cmd({ cmd: 'close', table: T2.table }); await sleep(900); const c = await s.request('move', { hwnd: T2.hwnd, to: { x: 100, y: 100 } });
    check('a closed simulator window is detected and refused', ['window-gone', 'target-not-registered'].includes(c.code), c.code);
  }
  // ---- 9. emergency stop and release ----
  { const st = await s.call('estop', { reason: 'acceptance test' }); const r = await s.request('move', { hwnd: T1.hwnd, to: { x: T1.client.x + 10, y: T1.client.y + 10 } });
    check('emergency stop latches: queued and new input refused until an explicit reset', st.estop && r.code === 'emergency-stop', r.code);
    const re = await s.request('arm'); check('automation cannot be re-enabled while the stop is latched', re.code === 'emergency-stop', re.code);
    await s.call('reset-estop'); await s.call('arm'); const fin = await s.call('status'); check('no mouse button or key held by the driver', fin.heldButtons === false && fin.heldKeys === 0, { heldButtons: fin.heldButtons, heldKeys: fin.heldKeys });
    env.driverStats = fin.stats;
  }
  const sum = await fx.summary(); env.oracle = sum.map((t) => ({ table: t.table, counts: t.counts }));
  check('the table never received a click on an old frame (no duplicate or late action)', sum.every((t) => t.counts.staleClicks === 0), sum.map((t) => t.counts.staleClicks));
  check('no press outside a control and no double-click reached the table (consecutive clicks on one spot are spaced beyond the double-click time)', sum.every((t) => t.counts.downOutsideControls === 0 && t.counts.doubleClicks === 0), { perTable: sum.map((t) => ({ outside: t.counts.downOutsideControls, doubleClicks: t.counts.doubleClicks })), guards: env.driverStats && env.driverStats.doubleClickGuards });
  await fx.stop(); await s.close(); await sleep(500);
  const leftover = cp.spawnSync('tasklist', ['/FI', 'IMAGENAME eq EightMaxInput.exe', '/NH'], { encoding: 'utf8' }).stdout || ''; check('the driver process exits on shutdown (no orphan)', !/EightMaxInput\.exe/i.test(leftover), leftover.trim().slice(0, 200));
  return finish(env);
}
function finish(env) {
  const passed = checks.filter((c) => c.ok).length, doc = { format: 'eightmax-input-acceptance', version: 1, app: '0.35.0', at: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), environment: env, passed, total: checks.length, ok: passed === checks.length && checks.length > 0, checks, oracleDir: ORACLE };
  fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(doc, null, 2)); console.log('input acceptance: ' + passed + '/' + checks.length + ' passed -> ' + OUT); process.exitCode = doc.ok ? 0 : 1;
}
main().catch((e) => { check('acceptance run completed', false, e.stack); finish({}); });
