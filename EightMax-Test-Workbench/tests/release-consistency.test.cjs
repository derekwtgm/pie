'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.join(__dirname, '..'), read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const EM = require('../src/engine.js');

test('one application version everywhere', () => {
  const v = EM.VERSION;
  assert.match(read('desktop/DesktopHost.cs'), new RegExp('Version="' + v.replace(/\./g, '\\.') + '"'));
  for (const f of ['windows/Install-Workbench.ps1', 'windows/Start-Workbench.ps1', 'windows/Test-Desktop.ps1']) assert.match(read(f), new RegExp(v.replace(/\./g, '\\.')), f);
  assert.match(read('START.html'), new RegExp("VERSION='" + v.replace(/\./g, '\\.') + "'"));
  assert.match(read('READ-ME-FIRST.txt'), new RegExp(v.replace(/\./g, '\\.')));
  assert.match(read('docs/CHANGELOG.md'), new RegExp('^# ' + v.replace(/\./g, '\\.'), 'm'));
});

test('engine identity is unchanged: vendor files and native build match the provenance record', () => {
  const prov = JSON.parse(read('vendor/eightmax-5.1/provenance.json'));
  assert.equal(prov.build, '7d08acc7eb4577ee');
  for (const f of prov.files) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f.path))).digest('hex'), f.sha256, f.path);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'native/mwcli.exe'))).digest('hex'), 'b3e675bfe2ae231e7d637de07886af6b511905d5225db96fe12ce2c3ccab2f72');
});

test('every new module is wired into the standalone build and the dashboard', () => {
  const build = read('tools/build.py'), dash = read('dashboard.html'), html = read('START.html');
  for (const m of ['hand-ledger', 'hand-state', 'solver-service', 'test-executor', 'multitable', 'vision-ocr', 'hardware-report', 'multitable-ui', 'image-codec', 'solver-tree', 'screen-capture', 'sim-display', 'vision-track', 'vision-metrics', 'full-hand', 'capture-ui', 'resource-monitor', 'platform-profile', 'calibration', 'capture-manager', 'execution-adapters', 'platform-ui']) {
    assert.ok(build.includes("'" + m + ".js'"), m + ' missing from build.py');
    assert.ok(dash.includes('src/' + m + '.js'), m + ' missing from dashboard.html');
    assert.ok(fs.existsSync(path.join(root, 'src', m + '.js')));
  }
  assert.ok(html.includes('id="mt-panel"') && html.includes('WorkbenchMultiTable'), 'START.html is rebuilt with the panel');
  assert.ok(!/<script[^>]+src=/i.test(html), 'standalone page has no external scripts');
});

test('standalone START.html is exactly what tools/build.py produces from the sources', () => {
  const cp = require('node:child_process'), before = fs.readFileSync(path.join(root, 'START.html'));
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'em-build-'));
  for (const d of ['src', 'vendor', 'tools']) fs.cpSync(path.join(root, d), path.join(tmp, d), { recursive: true });
  fs.copyFileSync(path.join(root, 'dashboard.html'), path.join(tmp, 'dashboard.html'));
  cp.execFileSync('python3', [path.join(tmp, 'tools/build.py')], { cwd: tmp });
  assert.ok(before.equals(fs.readFileSync(path.join(tmp, 'START.html'))), 'START.html is stale: run python3 tools/build.py');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('Windows scripts and launchers exist; prebuilt host is a 64-bit PE and is referenced by the launcher', () => {
  for (const f of ['START-DESKTOP.cmd', 'INSTALL-WINDOWS.cmd', 'UNINSTALL-WINDOWS.cmd', 'ROLLBACK-WINDOWS.cmd', 'RUN-DESKTOP-CHECKS.cmd', 'RUN-HARDWARE-CHECK.cmd', 'windows/Test-Hardware.ps1', 'windows/Rollback-Workbench.ps1']) assert.ok(fs.existsSync(path.join(root, f)), f);
  const exe = fs.readFileSync(path.join(root, 'desktop/bin/EightMaxWorkbench.exe'));
  assert.equal(exe.slice(0, 2).toString(), 'MZ'); const pe = exe.readUInt32LE(0x3c); assert.equal(exe.slice(pe, pe + 4).toString('latin1'), 'PE\0\0'); assert.equal(exe.readUInt16LE(pe + 4), 0x8664, 'x64 machine type');
  assert.match(read('windows/Start-Desktop.ps1'), /desktop\\bin\\EightMaxWorkbench\.exe/);
  assert.match(read('windows/Start-Desktop.ps1'), /ForceCompile/);
});

test('no module in the new code references live-client interaction, process memory or evasion', () => {
  const banned = /OpenProcess|ReadProcessMemory|SetWindowsHookEx|keybd_event|SendInput|mouse_event|anti-?cheat bypass|FindWindow/i;
  for (const m of ['hand-ledger', 'hand-state', 'solver-service', 'test-executor', 'multitable', 'vision-ocr', 'hardware-report', 'multitable-ui', 'image-codec', 'solver-tree', 'screen-capture', 'sim-display', 'vision-track', 'vision-metrics', 'full-hand', 'capture-ui']) assert.ok(!banned.test(read('src/' + m + '.js')), m);
});
