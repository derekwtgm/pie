'use strict';
// 0.35.0 test helper: how to run the REAL input driver code without touching the desktop.
//   Windows: desktop/bin/EightMaxInput.exe with --backend virtual (the in-memory desktop inside the same executable).
//   Linux:   compile desktop/input/*.cs with Mono's mcs (C# 5, like the Windows build) and run it with mono --backend virtual.
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const has = (c, a) => { try { return cp.spawnSync(c, a, { stdio: 'ignore' }).status === 0; } catch (e) { return false; } };
let cached;
function driverCommand() {
  if (cached !== undefined) return cached;
  if (process.platform === 'win32') { const exe = path.join(ROOT, 'desktop', 'bin', 'EightMaxInput.exe'); cached = fs.existsSync(exe) ? { exe, pre: [] } : null; return cached; }
  if (!has('mcs', ['--version']) || !has('mono', ['--version'])) { cached = null; return null; }
  const src = path.join(ROOT, 'desktop', 'input'), files = fs.readdirSync(src).filter((f) => f.endsWith('.cs')).sort();
  const h = crypto.createHash('sha256'); for (const f of files) h.update(fs.readFileSync(path.join(src, f)));
  const out = path.join(os.tmpdir(), 'eightmax-input-' + h.digest('hex').slice(0, 16) + '.exe');
  if (!fs.existsSync(out)) {
    const r = cp.spawnSync('mcs', ['-langversion:5', '-platform:x64', '-nologo', '-out:' + out, '-r:System.Web.Extensions.dll', '-r:System.Windows.Forms.dll', '-r:System.Drawing.dll', ...files.map((f) => path.join(src, f))], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('mcs failed: ' + r.stdout + r.stderr);
  }
  cached = { exe: 'mono', pre: [out] }; return cached;
}
/** A virtual desktop: `tables` windows with Fold/Check/Call/Raise buttons and an Edit wager field, laid out like the fixture. */
function virtualDesktop(file, o = {}) {
  const screen = o.screen || { x: 0, y: 0, w: 1920, h: 1080 }, n = o.tables || 1, windows = [];
  for (let i = 0; i < n; i++) {
    const cw = o.clientW || 960, ch = Math.round(cw / 1.6), cx = (o.x0 || 40) + i * (o.dx || 60), cy = (o.y0 || 60) + i * (o.dy || 40);
    const box = (b) => ({ x: Math.round(cx + b.x * cw), y: Math.round(cy + b.y * ch), w: Math.round(b.w * cw), h: Math.round(b.h * ch) });
    const base = 0x10000 * (i + 1);
    windows.push({ hwnd: base, pid: 4000 + i, start: 1234567 + i, title: 'EightMax Test Table ' + String(i + 1).padStart(2, '0'), class: 'WindowsForms10.Window.8.app', exe: 'C:/EightMax/EightMaxTestTable.exe', window: { x: cx - 8, y: cy - 31, w: cw + 16, h: ch + 39 }, client: { x: cx, y: cy, w: cw, h: ch },
      controls: [['fold', { x: 0.6, y: 0.93, w: 0.1, h: 0.05 }], ['check', { x: 0.72, y: 0.93, w: 0.1, h: 0.05 }], ['call', { x: 0.84, y: 0.93, w: 0.07, h: 0.05 }], ['raise', { x: 0.92, y: 0.93, w: 0.07, h: 0.05 }]].map(([t, b], k) => ({ hwnd: base + 1 + k, class: 'WindowsForms10.BUTTON', text: t, box: box(b) }))
        .concat([{ hwnd: base + 9, class: 'WindowsForms10.EDIT', text: '', box: box({ x: 0.42, y: 0.93, w: 0.15, h: 0.05 }) }]) });
  }
  fs.writeFileSync(file, JSON.stringify({ screen, windows }));
  return { screen, windows };
}
const virtualSha = (pid) => '0'.repeat(56) + pid.toString(16).padStart(8, '0');
const authorization = (o = {}) => ({ format: 'eightmax-simulator-authorization', version: 1, operatorOwnsSimulator: true, testEnvironmentOnly: true, noRealMoney: true, expiresAtUnixMs: Date.now() + 3600e3, executable: { fileName: 'EightMaxTestTable.exe', sha256: virtualSha(4000) }, ...o });
module.exports = { ROOT, driverCommand, virtualDesktop, virtualSha, authorization };
