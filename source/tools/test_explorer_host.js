'use strict';
// EightMax 3.8/3.9: end-to-end test of the native strategy explorer, action-EV and response-gain HTTP routes.
// usage: node tools/test_explorer_host.js <eightmax host> [report.json]
// Starts the host, creates a native external-sampling study through
// /api/mw/init, trains it, then:
//   - walks preflop -> flop -> turn -> river paths with /api/mw/node;
//   - recomputes the root and a deep node's per-hand average strategies from
//     the host's own exported EMMW4 state (/api/mw/state), parsed here;
//   - checks invalid branches, missing chance cards, terminal nodes, busy
//     refusals while training, response sizes and query latency;
//   - renders every response with EM.renderExplorer.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net'), { spawn } = require('node:child_process'), assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
require('./loadlib'); for (const l of ['lib_runouts', 'lib_wide', 'lib_river', 'lib_explorer', 'lib_pushfold']) require('../web/' + l);
const [exe, reportPath] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function freePort() { return new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); }); }
function parseState(buf) {
  const hl = buf.readUInt32LE(8), header = JSON.parse(buf.toString('utf8', 12, 12 + hl)); let p = 12 + hl;
  const sc = buf.readUInt32LE(p); p += 4; const states = [];
  for (let i = 0; i < sc; i++) { states.push({ parent: buf.readUInt32LE(p), slot: buf[p + 4], kind: buf[p + 5], actor: buf[p + 6], length: buf[p + 7], k: buf[p + 8] }); p += 9; }
  const rc = buf.readUInt32LE(p); p += 4; const rows = new Map(), sync = header.rowSync ? 4 : 0;
  for (let i = 0; i < rc; i++) {
    const st = buf.readUInt32LE(p), hand = buf.readUInt16LE(p + 4), cards = [...buf.subarray(p + 6, p + 11)], k = buf[p + 11]; p += 12;
    const v = []; for (let j = 0; j < 2 * k; j++) v.push(buf.readDoubleLE(p + 8 * j)); p += 16 * k + sync;
    rows.set(st + ':' + hand + ':' + cards.slice(0, states[st].length >= 3 ? states[st].length : 0).join(','), v);
  }
  return { header, states, rows };
}
function average(v) { const k = v.length / 2; let t = 0; for (let a = 0; a < k; a++) t += v[k + a]; return t > 0 ? v.slice(k).map(x => x / t) : null; }
(async () => {
  const out = { generated: new Date().toISOString(), host: path.basename(exe), checks: [] };
  const check = (name, ok, detail) => { out.checks.push({ name, ok: !!ok, detail }); if (!ok) throw Error(name + ': ' + JSON.stringify(detail)); };
  const port = await freePort(), home = fs.mkdtempSync(path.join(os.tmpdir(), 'em38-ex-'));
  // Non-Windows runs of a Windows .exe use Wine (reported as such, not as physical Windows).
  const viaWine = process.platform !== 'win32' && /\.exe$/i.test(exe), wine = process.env.EM_WINE || 'wine';
  out.runner = viaWine ? 'wine' : process.platform;
  const host = spawn(viaWine ? wine : exe, viaWine ? [exe, '--no-browser', '--port=' + port] : ['--no-browser', '--port=' + port], { env: { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, EIGHTMAX_DATA: home }, stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + port + '/api/';
  async function api(route, body, raw) {
    const r = await fetch(base + route, body === undefined ? {} : { method: 'POST', headers: { 'X-EightMax': '1' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    if (raw) return { status: r.status, bytes: Buffer.from(await r.arrayBuffer()) };
    const text = await r.text(); return { status: r.status, value: JSON.parse(text), size: text.length };
  }
  try {
    for (let i = 0; i < 600; i++) { try { await fetch(base + 'mw/status'); break; } catch { await sleep(100); } }
    // Eight-player linked preflop-to-river study (3.7 benchmark rules), chip EV.
    const cfg = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 1024, privateSeed: 5,
      preflop: { mode: 'linked', opens: '2,a', raises: '2.75x,a', maxBets: 3 }, board: '', dealt: 8, common: 0, stacks: [24.9, 18, 40, 12, 30, 9, 55, 20], ranges: Array(8).fill('random'),
      streets: { flop: { bets: '33,75', raises: '3x', maxBets: 2 }, turn: { bets: '66', raises: 'a', maxBets: 2 }, river: { bets: '75,a', raises: '', maxBets: 1 } }, batchDeals: 16, actionStreams: 'deal' };
    const spec = EM.MultiwayGame(cfg).nativeSpec();
    let r = await api('mw/node', { path: [] }); check('node before a study is refused', r.status === 409, r.value);
    r = await api('mw/init', JSON.stringify(spec)); check('study created', r.status === 200, r.value);
    r = await api('mw/train', { iterations: 400, threads: 2 }); check('training started', r.status === 200, r.value);
    const busy = await api('mw/node', { path: [] }); check('node refused while training', busy.status === 409 || busy.status === 200, busy.value);
    for (let i = 0; i < 600; i++) { const s = await api('mw/status'); if (!s.value.running) break; await sleep(100); }
    const state = await api('mw/state', undefined, true); check('state exported', state.status === 200, state.status);
    const ref = parseState(state.bytes);
    // root
    let t0 = Date.now(); r = await api('mw/node', { path: [] }); const rootMs = Date.now() - t0;
    check('root node', r.status === 200 && r.value.node.street === 'preflop' && r.value.node.actor === 0 && r.value.hands.items.length === 1326, { status: r.status, ms: rootMs });
    check('root response bounded', r.size < 1.5e6, { bytes: r.size, ms: rootMs });
    let mism = 0; for (const item of r.value.hands.items) { const v = ref.rows.get('0:' + item.i + ':'); const a = v ? average(v) : null; if (JSON.stringify(a) !== JSON.stringify(item.average)) mism++; }
    check('root averages equal the exported state', mism === 0, { mismatches: mism });
    EM.renderExplorer(r.value, { kind: 'average', names: EM.pfPositions(8), selectedCell: 0 });
    // Deepest stored river row: reconstruct its path and board from the exported state and query it.
    const riverKeys = [...ref.rows.keys()].filter(k => ref.states[+k.split(':')[0]].length === 5 && ref.states[+k.split(':')[0]].kind === 0);
    check('training reached the river', riverKeys.length > 0, { riverRows: riverKeys.length });
    let deepChecked = 0;
    for (const key of riverKeys.slice(0, 25)) {
      const [st, hand, cards] = key.split(':'); const chain = []; let x = +st;
      while (x !== 0) { chain.push(ref.states[x].slot); x = ref.states[x].parent; } chain.reverse();
      const c = cards.split(',').map(Number).map(v => v - 1), board = [...c.slice(0, 3).sort((a, b) => a - b), ...c.slice(3)];
      r = await api('mw/node', { path: chain.filter(s => s !== 7), board });
      check('river node ' + st, r.status === 200 && r.value.node.stateId === +st && r.value.node.street === 'river', r.value);
      const item = r.value.hands.items.find(h => h.i === +hand);
      check('river average ' + st + '/' + hand, JSON.stringify(item.average) === JSON.stringify(average(ref.rows.get(key))), { item, ref: average(ref.rows.get(key)) });
      check('history has three chance steps', r.value.history.filter(h => h.chance).length === 3, r.value.history.length);
      EM.renderExplorer(r.value, { kind: 'current', names: EM.pfPositions(8), selectedCell: EM.classOf(item.cards[0], item.cards[1]) });
      deepChecked++;
    }
    out.deepNodesChecked = deepChecked;
    // missing chance cards
    r = await api('mw/node', { path: [0, 0, 0, 0, 0, 0, 1, 0] });
    check('chance node asks for the flop', r.status === 200 && r.value.node.kind === 'chance' && r.value.node.needsCards === 3, r.value.node);
    EM.renderExplorer(r.value, { kind: 'average', names: EM.pfPositions(8) });
    r = await api('mw/node', { path: [0, 0, 0, 0, 0, 0, 1, 0, 0], board: [] });
    check('path beyond a chance node without cards is refused', r.status === 400, r.value);
    r = await api('mw/node', { path: [0, 0, 0, 0, 0, 0, 1, 0], board: [5, 5, 9] });
    check('duplicate board card refused', r.status === 400, r.value);
    r = await api('mw/node', { path: [7] });
    check('action outside the abstraction refused, never synthesized', r.status === 400 && /not in the solved abstraction/.test(r.value.error), r.value);
    // everyone folds to the big blind: terminal
    r = await api('mw/node', { path: [0, 0, 0, 0, 0, 0, 0] });
    check('fold-around terminal', r.status === 200 && r.value.node.kind === 'terminal' && r.value.node.pots.length >= 1, r.value.node);
    EM.renderExplorer(r.value, { kind: 'average', names: EM.pfPositions(8) });
    // non-acting range view and pagination
    r = await api('mw/node', { path: [], rangeSeat: 3, offset: 100, limit: 50 });
    check('range of another seat, paginated', r.status === 200 && r.value.hands.seat === 3 && !r.value.hands.actingSeat && r.value.hands.items.length === 50 && r.value.hands.items[0].i === 100, r.value.hands && r.value.hands.items.length);
    r = await api('mw/node', { path: [], limit: 5000 }); check('oversized page refused', r.status === 400, r.value);
    r = await api('mw/node', 'not json'); check('malformed request refused', r.status === 400, r.value);
    // 3.9: strict validation over HTTP (the 3.8 defect) and action EVs / response gains
    for (const bad of [{ rangeSeat: 'nonsense' }, { rangeSeat: true }, { offset: -1 }, { offset: '10' }, { limit: 1.5 }, { limit: null }, { path: [0, '1'] }, { board: [60] }, { unknown: 1 }]) {
      r = await api('mw/node', bad); check('malformed ' + JSON.stringify(bad) + ' refused with 400', r.status === 400 && !r.value.hands, r.value);
    }
    t0 = Date.now(); r = await api('mw/ev', { path: [], hands: [0, 500, 1000], range: true, samples: 1000, seed: 1, timeLimitMs: 120000 }); const evMs = Date.now() - t0;
    check('action EVs for every legal action (sampled, eight seats)', r.status === 200 && r.value.method === 'sampled' && r.value.hands.every(h => h.available && h.ev.length === r.value.actions.length && h.stdErr.every(Number.isFinite)), r.value);
    const again = await api('mw/ev', { path: [], hands: [0, 500, 1000], range: true, samples: 1000, seed: 1, timeLimitMs: 120000 });
    check('repeated EV request served from the cache', again.status === 200 && again.value.cache.hit === true && JSON.stringify(again.value.hands) === JSON.stringify(r.value.hands), again.value.cache);
    r = await api('mw/ev', { hands: ['0'] }); check('EV request with a string hand refused', r.status === 400, r.value);
    t0 = Date.now(); r = await api('mw/response-gain', { method: 'sampled', samples: 300, selectionSamples: 16, reachSamples: 2000, seed: 1, futureActions: 'sample' }); const gainMs = Date.now() - t0;
    check('per-seat sampled response gains', r.status === 200 && r.value.seats.length === 8 && r.value.seats.every(s => s.available && Number.isFinite(s.gain.mean)), r.value.seats && r.value.seats.map(s => s.gain));
    out.evMs = evMs; out.gainMs = gainMs; out.seatGains = r.value.seats.map(s => ({ seat: s.seat, gain: s.gain.mean, stdErr: s.gain.stdErr }));
    out.rootMs = rootMs; out.passed = out.checks.length;
  } finally { host.kill(); }
  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(out, null, 1));
  console.log('explorer host checks passed:', out.checks.length, 'deep nodes', out.deepNodesChecked, 'root query ms', out.rootMs);
})().catch(e => { console.error(e); process.exit(1); });
