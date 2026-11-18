'use strict';
/* Real-browser test of the 0.25 platform workspace (Chromium via Playwright). Skipped, and reported as skipped, when no browser is available. */
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
let chromium = null; try { chromium = require('playwright').chromium; } catch (e) { /* skipped below */ }
const exe = process.env.CHROME_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
test('platform workspace works in a real browser: capture, calibration edit/learn/preview, bad edit refused, simulation run, no page errors', { skip: chromium ? false : 'playwright not installed', timeout: 240000 }, async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'], ...(exe && fs.existsSync(exe) && fs.statSync(exe).isFile() ? { executablePath: exe } : {}) }), page = await browser.newPage({ viewport: { width: 1500, height: 1100 } }), errs = [];
  try {
    page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto('file://' + path.resolve(__dirname, '../START.html')); await page.click('#pf-nav'); await page.waitForSelector('#pf-panel:not([hidden])');
    assert.equal(await page.locator('#pf-profile option').count(), 2); assert.ok((await page.locator('#pf-region option').count()) > 50);
    assert.match(await page.textContent('#pf-catalog'), /Windows Graphics Capture[\s\S]*not-implemented/);
    await page.click('#pf-cap-start'); await page.waitForFunction(() => /healthy/.test(document.getElementById('pf-health').textContent) && /admitted|rejected/.test(document.getElementById('pf-recog').textContent), null, { timeout: 20000 }); assert.match(await page.textContent('#pf-recog'), /admitted[\s\S]*image-based/);
    await page.click('#pf-cap-stop');
    await page.click('[data-pf-tab=calibration]'); await page.click('#pf-sample'); await page.click('#pf-learn'); assert.match(await page.textContent('#pf-cal-out'), /digit templates/); await page.click('#pf-preview'); assert.match(await page.textContent('#pf-cal-out'), /read confidence/);
    await page.fill('#pf-rx', '0.99'); await page.click('#pf-apply'); assert.match(await page.textContent('#pf-cal-status'), /Rejected/);
    await page.click('[data-pf-tab=execution]'); assert.equal(await page.$eval('#pf-mode option[value=qa]', (o) => o.disabled), true, 'external QA stays disabled');
    await page.selectOption('#pf-mode', 'simulation'); await page.fill('#pf-hands', '1'); await page.click('#pf-run'); await page.waitForFunction(() => /Finished|Stopped/.test(document.getElementById('pf-exec-status').textContent), null, { timeout: 180000 });
    assert.match(await page.textContent('#pf-exec-status'), /Finished: 1 hand/); await page.click('[data-pf-tab=solver]'); assert.match(await page.textContent('#pf-solver-out'), /EightMax 5\.1 build 7d08acc7eb4577ee/);
    await page.click('[data-pf-tab=performance]'); assert.match(await page.textContent('#pf-perf-out'), /GPU[\s\S]*not used/); assert.match(await page.textContent('#pf-perf-out'), /valid/);
    assert.deepEqual(errs, []);
  } finally { await browser.close(); }
});
