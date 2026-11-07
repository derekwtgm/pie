'use strict';
// Integration test for the native EightMax host (EightMax.exe or the Linux build).
// Usage: node tools/test_native_host.js <executable> <build-dir-with-native.html-and-build-info.json> [report.json]
// A Windows .exe is started through Wine when this runs on Linux; the report
// records which runtime was used. Wine is not Windows: a Wine pass does not
// replace a run on real Windows (tools/test_windows.ps1).
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const http = require('node:http'), { spawn } = require('node:child_process'), assert = require('node:assert/strict');
const [exeArg, buildArg, reportArg] = process.argv.slice(2);
if (!exeArg || !buildArg) { console.error('Usage: node test_native_host.js <exe> <build-dir> [report.json]'); process.exit(2); }
const exe = path.resolve(exeArg), buildDir = path.resolve(buildArg);
const info = JSON.parse(fs.readFileSync(path.join(buildDir, 'build-info.json'), 'utf8'));
const nativeHtml = fs.readFileSync(path.join(buildDir, 'native.html'));
const viaWine = exe.toLowerCase().endsWith('.exe') && process.platform !== 'win32';
const checks = [], timings = {};
let child = null, port = 0, failure = null, stdout = '', env = process.env;
const pass = (msg) => { checks.push(msg); console.log('PASS  ' + msg); };

function freePort() { return new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); }); }
function request(method, route, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port, method, path: route, timeout: 60000,
      headers: { Host: '127.0.0.1:' + port, ...(method === 'POST' ? { 'X-EightMax': '1', 'Content-Type': 'application/json' } : {}),
        ...(data ? { 'Content-Length': data.length } : { 'Content-Length': 0 }), ...headers } }, (res) => {
      const parts = []; res.on('data', (c) => parts.push(c));
      res.on('end', () => { const raw = Buffer.concat(parts); let json = null; try { json = JSON.parse(raw.toString('utf8')); } catch (e) { /* not JSON */ }
        resolve({ status: res.statusCode, raw, json }); });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('request timeout')));
    if (data) req.write(data); req.end();
  });
}
const api = async (route, body) => { const r = await request(body === undefined ? 'GET' : 'POST', '/api/' + route, body); if (r.status !== 200) throw Error(route + ' -> ' + r.status + ' ' + r.raw); return r.json; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = '23456789TJQKA', S = 'cdhs', card = (t) => 4 * R.indexOf(t[0]) + S.indexOf(t[1]);
function handId(t) { let a = card(t.slice(0, 2)), b = card(t.slice(2, 4)); if (a > b) [a, b] = [b, a]; return a * (103 - a) / 2 + b - a - 1; }
const weights = (hs) => { const w = Array(1326).fill(0); for (const h of hs) w[handId(h)] = 1; return w; };
async function waitDone(limitMs) {
  const end = Date.now() + limitMs; let st;
  do { st = await api('status'); if (st.done && !st.running) return st; await sleep(30); } while (Date.now() < end);
  return st;
}

(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'eightmax-host-'));
  try {
    port = await freePort();
    const args = ['--no-browser', '--port=' + port];
    env = { ...process.env, EIGHTMAX_GPU: 'off', EIGHTMAX_THREADS: '2', HOME: home, USERPROFILE: home, WINEDEBUG: '-all' };
    const t0 = Date.now();
    child = viaWine ? spawn('wine', [exe, ...args], { env }) : spawn(exe, args, { env });
    child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stdout += d; });
    let hostInfo = null;
    for (const end = Date.now() + (viaWine ? 60000 : 15000); Date.now() < end;) {
      if (child.exitCode !== null) throw Error('host exited early: ' + stdout);
      try { hostInfo = await api('info'); break; } catch (e) { await sleep(150); }
    }
    timings.startupSeconds = (Date.now() - t0) / 1000;
    assert.ok(hostInfo, 'host did not start');
    assert.equal(hostInfo.native, true); assert.equal(hostInfo.version, info.version); assert.equal(hostInfo.build, info.build);
    pass(`Host starts (${timings.startupSeconds.toFixed(1)} s) and reports version ${hostInfo.version}, build ${hostInfo.build}, engine ${hostInfo.engine}`);
    const page = await request('GET', '/');
    assert.equal(page.status, 200); assert.ok(page.raw.equals(nativeHtml), 'embedded UI differs from build/native.html');
    assert.ok(page.raw.includes('globalThis.EM.BUILD = Object.freeze({version:"' + info.version + '",build:"' + info.build + '"})'));
    pass('Embedded interface is byte-identical to the built native.html and carries the same version and build id');

    // Request validation and same-machine protection
    for (const [hdrs, label] of [[{ Host: '127.0.0.1:' + port + '.example.com' }, 'prefix-matching Host header'], [{ Host: 'evil.example' }, 'foreign Host header']]) {
      assert.equal((await request('GET', '/api/info', undefined, hdrs)).status, 403); pass('Refuses a ' + label);
    }
    assert.equal((await request('POST', '/api/build', '{}', { 'X-EightMax': '' })).status, 403); pass('Refuses POST without the app header');
    for (const route of ['build', 'estimate', 'report', 'save', 'load']) {
      assert.equal((await request('POST', '/api/' + route, '')).status, 400); pass(`Empty ${route} request is refused (400)`);
    }
    assert.equal((await request('POST', '/api/build', '{"board":[1,2')).status, 400); pass('Malformed JSON is refused');
    for (const name of ['con', 'NUL.txt', 'Com3', 'lpt9', 'aux.em8', '..', '   ']) {
      assert.equal((await request('POST', '/api/save', { name })).status, 400); pass(`Reserved or empty save name ${JSON.stringify(name)} is refused`);
    }

    // Known river equilibrium (same spot as test_windows.ps1)
    const cfg = { board: ['2c', '4d', '7h', '9s', 'Jc'].map(card), pot: 10, stack: 10, ranges: [weights(['QhQd']), weights(['AsAd', 'KsTh'])],
      sizes: { bet: [['', ''], ['', ''], ['', '100']], raise: [['', ''], ['', ''], ['', '']] }, compress: 0, iso: 0, gpu: 0, forceAllin: 0, maxBets: 1 };
    const bad = { ...cfg, board: [0, 0, 22, 31, 36] };
    assert.equal((await request('POST', '/api/estimate', bad)).status, 400); pass('Duplicate board cards are rejected');
    const meta = await api('build', cfg);
    const early = await request('POST', '/api/save', { name: 'unsolved' });
    assert.equal(early.status, 400); assert.match(String(early.raw), /Solve the spot before saving/); pass('Saving before solving reports a clear message');
    let t = Date.now(); await api('solve', { maxIter: 10000, target: 0.000001, power: 0 });
    const st = await waitDone(120000); timings.riverSolveSeconds = (Date.now() - t) / 1000;
    assert.ok(st.done && !st.running && st.error === null, JSON.stringify(st));
    const aggressor = await api('node', { path: [0] }), defender = await api('node', { path: [0, 1] });
    const strong = meta.combos[1].indexOf(handId('AsAd')), weak = meta.combos[1].indexOf(handId('KsTh'));
    assert.ok(aggressor.strategy[2 + strong] > 0.995 && Math.abs(aggressor.strategy[2 + weak] - 0.5) < 0.015 && Math.abs(defender.strategy[1] - 0.5) < 0.015);
    pass(`Known river equilibrium reproduced natively (${st.it} iterations, ${timings.riverSolveSeconds.toFixed(2)} s): value bets, half bluffs, half calls`);

    // Save / list / load round trip
    const saved = await api('save', { name: 'roundtrip test' }); assert.ok(saved.ok);
    const list = await api('saves'); assert.ok(list.some((x) => x.name === 'roundtrip test'));
    await api('build', { ...cfg, pot: 20 });
    const loaded = await api('load', { name: 'roundtrip test' }); assert.equal(loaded.it, st.it);
    const again = await api('node', { path: [0] }); assert.deepEqual(again.strategy, aggressor.strategy);
    pass('Saved solution lists, reloads and reproduces the identical strategy');
    assert.equal((await request('POST', '/api/load', { name: 'missing file' })).status, 400); pass('Loading a missing file is refused');
    const savedFile = /^[A-Za-z]:\\/.test(saved.file) && viaWine ? require('node:child_process').execFileSync('winepath', ['-u', saved.file], { env }).toString().trim() : saved.file;
    fs.writeFileSync(path.join(path.dirname(savedFile), 'junk.em8'), 'EM8SOL2\0garbage');
    const junk = await request('POST', '/api/load', { name: 'junk' }); assert.equal(junk.status, 400);
    pass('A corrupted solution file is refused without crashing');
    await api('delete', { name: 'roundtrip test' });

    // Long solve: the host stays responsive and stops on request
    const flop = { ...cfg, board: ['2c', '4d', '7h'].map(card), stack: 60, ranges: [weights(['QhQd', 'JhJd', 'AcKc', '9h8h', 'TcTd']), weights(['AsAd', 'KsTh', 'QcJc', '6h5h', '8s8d'])],
      sizes: { bet: [['33,75', '33,75'], ['50,100', '50,100'], ['75,150', '75,150']], raise: [['3x', '3x'], ['3x', '3x'], ['a', 'a']] }, maxBets: 3 };
    await api('build', flop); t = Date.now(); await api('solve', { maxIter: 49000, target: 0.0000001, power: 0 });
    await sleep(800); const busy = await api('status'); assert.ok(busy.running, 'long solve should still be running');
    const before = Date.now(); await api('info'); timings.responsiveMs = Date.now() - before;
    await request('POST', '/api/stop', '{}'); const stopped = await waitDone(30000);
    assert.ok(!stopped.running && stopped.stopped, JSON.stringify(stopped));
    pass(`Host answers during a long solve (${timings.responsiveMs} ms) and stops it on request after ${stopped.it} iterations`);
    assert.equal(child.exitCode, null); pass('Host is still running after every refused or cancelled request');
  } catch (e) {
    failure = e.stack || String(e); console.log('FAIL  ' + failure);
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM'); const end = Date.now() + 10000;
      while (child.exitCode === null && child.signalCode === null && Date.now() < end) await sleep(50);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (!failure) pass('Host shuts down when its process is terminated');
    }
    const report = { version: info.version, build: info.build, executable: path.basename(exe), runtime: viaWine ? 'wine (not Windows)' : process.platform,
      node: process.version, cpu: os.cpus()[0]?.model, passed: !failure, checks, timings, error: failure, generated: new Date().toISOString() };
    if (reportArg) fs.writeFileSync(reportArg, JSON.stringify(report, null, 1) + '\n');
    fs.rmSync(home, { recursive: true, force: true });
    process.exitCode = failure ? 1 : 0;
  }
})();
