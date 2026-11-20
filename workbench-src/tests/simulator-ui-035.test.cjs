'use strict';
// 0.35.0: the dashboard's Simulator Controls panel in a real browser (Playwright/Chromium) against a FAKE desktop host served on
// the host's own origin. Checks the beginner flow: list -> confirm -> register -> calibrate (UI Automation suggestions, preview,
// confidence) -> save profile -> dry-run preview (moves, no clicks) -> emergency stop. No real input happens here.
const test = require('node:test'), assert = require('node:assert/strict'), path = require('path'), fs = require('fs');
let chromium = null; try { ({ chromium } = require('playwright')); } catch (e) { /* not installed */ }
const ROOT = path.join(__dirname, '..'), FD = require('../src/fixture-dealer.js');
const skip = chromium && fs.existsSync(path.join(ROOT, 'START.html')) ? false : 'needs Playwright and START.html';
const TOKEN = 'b'.repeat(64);

test('simulator controls panel: register, calibrate with UI Automation suggestions, save, dry run, emergency stop', { skip, timeout: 120000 }, async () => {
  const html = fs.readFileSync(path.join(ROOT, 'START.html'), 'utf8'); let frame = null;
  const d = new FD.TableDealer({ table: 1, send: (m) => { if (m.type === 'frame') frame = m; } }); d.onWindow({ type: 'ready', client: { x: 100, y: 80, w: 960, h: 600 } });
  const client = { x: 100, y: 80, w: 960, h: 600 }, px = (b) => ({ x: Math.round(client.x + b.x * client.w), y: Math.round(client.y + b.y * client.h), w: Math.round(b.w * client.w), h: Math.round(b.h * client.h) });
  const commands = [], other = [];
  const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } }); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('dialog', (dlg) => dlg.accept());
  await page.route('http://127.0.0.1:48713/**', async (route) => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname;
    if (p === '/' || p === '/START.html') return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    if (req.headers()['x-eightmax-session'] !== TOKEN) return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"session"}' });
    const body = req.postData() ? JSON.parse(req.postData()) : null, j = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (p === '/api/input/status') return j({ format: 'eightmax-input-status', version: 1, running: true, driver: { driver: '0.35.0', armed: commands.includes('arm'), estop: other.includes('estop') ? 'dashboard' : null, capabilities: { hotkey: 'Ctrl+Alt+F12', hotkeyRegistered: true, dpiAwareness: 'per-monitor-v2', uiAutomation: true, rawInputOverride: true } }, events: [] });
    if (p === '/api/input/estop') { other.push('estop'); return j({ ok: true }); }
    if (p === '/api/capture/open') return j({ ok: true });
    if (p === '/api/capture/frame') return j({ ok: true, width: frame.w, height: frame.h, png: frame.png, bounds: { x: client.x, y: client.y, width: client.w, height: client.h }, dpiScale: 1.5, title: 'EightMax Test Table 01' });
    if (p === '/api/input/command') {
      commands.push(body.cmd);
      switch (body.cmd) {
        case 'list-windows': return j({ ok: true, windows: [{ hwnd: '0x1A2B', pid: 77, title: 'My Poker Simulator', exe: 'C:\\Sim\\MySim.exe', client, dpiScale: 1.5, minimized: false, registered: false }] });
        case 'exe-identity': return j({ ok: true, exeSha256: 'f'.repeat(64), window: {} });
        case 'uia-controls': return j({ ok: true, available: true, controls: [['Fold', 'fold'], ['Check', 'check'], ['Call', 'call'], ['Raise', 'raise'], ['All-in', 'allin']].map(([n, k]) => ({ name: n, type: 'Button', box: px(FD.CONTROLS[k]) })).concat([{ name: 'Wager amount', type: 'Edit', box: px(FD.WAGER_FIELD) }]) });
        case 'window-info': return j({ ok: true, window: { hwnd: body.hwnd, client, minimized: false } });
        default: return j({ ok: true, plannedMs: 10, actualMs: 11, steps: 2, clickedAt: body.to || { x: 0, y: 0 }, read: body.text, verified: true });
      }
    }
    return j({ ok: false, error: 'unhandled ' + p });
  });
  try {
    await page.goto('http://127.0.0.1:48713/#desktop-token=' + TOKEN); await page.click('#simc-nav'); await page.waitForTimeout(600);
    assert.match(await page.textContent('#simc-driver'), /running.*Ctrl\+Alt\+F12.*per-monitor-v2/);
    await page.selectOption('#simc-window', '0x1A2B');
    await page.click('#simc-register'); assert.match(await page.textContent('#simc-status'), /Calibrate the controls first|Confirm that/);
    // calibrate first (the profile binds the executable), then register
    await page.click('#simc-calibrate'); await page.waitForTimeout(500); assert.equal(await page.isVisible('#simc-canvas'), true);
    await page.click('#simc-uia'); await page.waitForTimeout(300);
    const report = await page.textContent('#simc-cal-report'); assert.match(report, /Confidence/);
    assert.match(await page.textContent('#simc-status'), /suggested: .*fold.*wager/);
    await page.fill('#simc-prof-id', 'my-sim'); const dl = page.waitForEvent('download'); await page.click('#simc-save-profile'); const file = await dl; assert.match(file.suggestedFilename(), /my-sim\.profile\.json/);
    assert.match(await page.textContent('#simc-status'), /saved .*bound to MySim\.exe/);
    for (const id of ['#simc-own', '#simc-test', '#simc-nomoney']) await page.check(id);
    await page.click('#simc-register'); await page.waitForTimeout(400); const reg = await page.textContent('#simc-status');
    assert.match(reg, /Registered My Poker Simulator/); assert.ok(commands.includes('register-target'));
    await page.click('#simc-preview'); await page.waitForTimeout(5000);
    assert.ok(commands.filter((c) => c === 'move').length >= 5, 'dry run moved to every control: ' + commands.join(',')); assert.ok(!commands.includes('move-click'), 'dry run never clicks');
    await page.click('#simc-estop'); await page.waitForTimeout(300); assert.ok(other.includes('estop')); assert.match(await page.textContent('#simc-status'), /EMERGENCY STOP/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
