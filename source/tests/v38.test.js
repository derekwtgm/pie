'use strict';
// EightMax 3.8 regressions: native performance caches keep exact results,
// native strategy explorer, restoration memory estimates, deterministic
// continuation with the betting-state store, and explorer rendering.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
const E = require('../tools/loadlib');
for (const l of ['lib_runouts', 'lib_wide', 'lib_river', 'lib_pushfold', 'lib_explorer']) require('../web/' + l);
const { withHost, home } = require('./checkpoint_host');
const tool = () => process.env.EM_TEST_MWCLI || require('./native_build').cli().cli;
const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'em38-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const mwcli = (args, opts = {}) => cp.execFileSync(tool(), args.map(String), { encoding: 'utf8', ...opts });
const base = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128 };
// Scenario rules of the 3.7/3.8 benchmarks (smaller budgets).
const studies = {
  threeRiver: { ...base, board: 'Ks8d5h2c2s', common: 12, stacks: [30, 30, 30], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc'], streets: { river: { bets: '50,125', raises: '2.5x', maxBets: 2 } }, privateSeed: 3 },
  icmFinal: { ...base, preflop: { mode: 'linked', opens: '2.2,a', raises: 'a', maxBets: 2 }, board: '', dealt: 8, common: 0, stacks: [30, 22, 15, 40, 9, 18, 25, 12], ranges: Array(8).fill('random'), icm: { payouts: [30, 20, 14, 11, 9, 7, 5, 4] }, streets: { flop: { bets: '50', raises: '', maxBets: 1 }, turn: { bets: 'a', raises: '', maxBets: 1 }, river: { bets: 'a', raises: '', maxBets: 1 } }, batchDeals: 4, actionStreams: 'deal', privateSeed: 4 },
  sixFlop: { ...base, board: 'Td7c2h', dealt: 8, common: 1.5, stacks: [20, 35, 8, 50, 14, 3], prior: Array(6).fill(2.5), folded: [1, 2.5], ranges: Array(6).fill('22+,A2s+,K9s+,QTs+,JTs,ATo+,KJo+:0.6'), streets: { flop: { bets: '33,a', raises: '3x,a', maxBets: 3 }, turn: { bets: '50,g', raises: 'a', maxBets: 2 }, river: { bets: '75,150', raises: 'a', maxBets: 2 } }, batchDeals: 4, actionStreams: 'deal', privateSeed: 6 },
  bubble: { ...base, preflop: { mode: 'shove' }, dealt: 4, common: 0, board: '', stacks: [12, 7, 20, 4], ranges: Array(4).fill('random'), icm: { payouts: [50, 30, 20] }, batchDeals: 4, actionStreams: 'deal', privateSeed: 8 },
};
function specFile(dir, cfg, extra = {}) { const f = path.join(dir, 'spec.json'); fs.writeFileSync(f, JSON.stringify({ ...E.MultiwayGame(cfg).nativeSpec(), ...extra })); return f; }
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
const average = v => { const k = v.length / 2; let t = 0; for (let a = 0; a < k; a++) t += v[k + a]; return t > 0 ? v.slice(k).map(x => x / t) : null; };
const current = v => { const k = v.length / 2, s = v.slice(0, k).map(x => Math.max(0, x)); let t = 0; for (const x of s) t += x; return s.map(x => t ? x / t : 1 / k); };

test('3.8 native caches keep results bit-identical to the JavaScript reference (3-way river, ICM final table, 6-seat flop, bubble)', t => {
  const dir = tmp(t);
  for (const [name, cfg] of Object.entries(studies)) for (const extra of [{}, { terminalBaseline: true }]) {
    const n = name === 'threeRiver' ? 300 : 12, spec = specFile(dir, { ...cfg, ...extra }), state = path.join(dir, name + '.state');
    mwcli([spec, n, 2, state, 256]);
    const g = E.MultiwayGame({ ...cfg, ...extra }); g.iterate(n);
    // Row order differs between the JavaScript and native writers (also in 3.7), so compare canonically.
    const js = parseState(Buffer.from(g.exportNative(true))), nat = parseState(fs.readFileSync(state));
    for (const f of ['iterations', 'trainingDeals', 'stateVisits', 'rng', 'actionRng']) assert.equal(js.header[f], nat.header[f], name + ' ' + f);
    assert.equal(js.rows.size, nat.rows.size, name + ' row count');
    const route = (S, i) => { const out = []; while (i !== 0) { out.push(S[i].slot); i = S[i].parent; } return out.reverse().join('.'); };
    const canon = st => new Map([...st.rows].map(([k, v]) => { const [s, h, c] = k.split(':'); return [route(st.states, +s) + ':' + h + ':' + c, v]; }));
    const a = canon(js), b = canon(nat); let diff = 0;
    for (const [k, v] of a) { const w = b.get(k); if (!w || w.length !== v.length || v.some((x, i) => !Object.is(x, w[i]))) diff++; }
    assert.equal(diff, 0, name + ' ' + JSON.stringify(extra) + ': ' + diff + ' rows differ from JavaScript');
  }
});
test('3.8 thread count and the betting-state store do not change results; store activates on revisited states', t => {
  const dir = tmp(t);
  for (const cfg of [studies.threeRiver, studies.sixFlop]) {
    const spec = specFile(dir, cfg), a = path.join(dir, 'a'), b = path.join(dir, 'b');
    const n = cfg === studies.threeRiver ? 2000 : 150;
    const ia = JSON.parse(mwcli([spec, n, 1, a, 256])), ib = JSON.parse(mwcli([spec, n, 4, b, 256]));
    assert.ok(fs.readFileSync(a).equals(fs.readFileSync(b)));
    if (cfg === studies.threeRiver) { assert.ok(ia.stateCache.states > 0 && ia.stateCache.states === ia.states, JSON.stringify(ia.stateCache)); assert.equal(ia.stateCache.chargedToTableBudget, false); }
  }
});
test('3.8 deterministic continuation: restore + one update equals the uninterrupted run (store, ICM, DCFR, CFR+)', t => {
  const dir = tmp(t);
  for (const [cfg, extra, n] of [[studies.threeRiver, {}, 1500], [studies.icmFinal, {}, 20], [studies.sixFlop, { weighting: 'dcfr' }, 30], [studies.sixFlop, { regretMatching: 'plus' }, 30]]) {
    const spec = specFile(dir, cfg, extra), a = path.join(dir, 'a'), b = path.join(dir, 'b'), c = path.join(dir, 'c');
    mwcli([spec, n, 2, a, 512]); mwcli([spec, n + 1, 2, b, 512]); mwcli([spec, 1, 2, c, 512, a]);
    assert.ok(fs.readFileSync(b).equals(fs.readFileSync(c)), JSON.stringify(extra) + ' resumed state differs');
  }
});
test('3.8 explorer: per-hand strategies, reach and aggregates equal an independent parse of the state on every street', t => {
  const dir = tmp(t), cfg = studies.icmFinal, spec = specFile(dir, cfg), state = path.join(dir, 's');
  mwcli([spec, 60, 2, state, 512]);
  const ref = parseState(fs.readFileSync(state)), spec0 = JSON.parse(fs.readFileSync(spec, 'utf8'));
  const query = q => { const f = path.join(dir, 'q.json'); fs.writeFileSync(f, JSON.stringify(q)); return JSON.parse(mwcli(['--node', spec, state, f])); };
  const byStreet = {}; for (const key of ref.rows.keys()) { const st = ref.states[+key.split(':')[0]]; (byStreet[st.length] ||= []).push(key); }
  assert.deepEqual(Object.keys(byStreet).sort(), ['0', '3', '4', '5']);
  let checked = 0;
  for (const keys of Object.values(byStreet)) for (const key of keys.filter((_, i) => i % Math.max(1, Math.floor(keys.length / 6)) === 0).slice(0, 6)) {
    const [st, hand, cards] = key.split(':'); const chain = []; let x = +st, seatPath = [];
    while (x !== 0) { chain.push(x); x = ref.states[x].parent; } chain.reverse();
    const c = cards ? cards.split(',').map(Number).map(v => v - 1) : [], board = c.length ? [...c.slice(0, 3).sort((a, b) => a - b), ...c.slice(3)] : [];
    const r = query({ path: chain.map(i => ref.states[i].slot).filter(s => s !== 7), board });
    assert.equal(r.node.stateId, +st); assert.equal(r.node.actor, ref.states[+st].actor);
    const item = r.hands.items.find(h => h.i === +hand), v = ref.rows.get(key);
    assert.deepEqual(item.average, average(v)); assert.deepEqual(item.current, current(v));
    // reach: weight x own average probabilities on the path
    const seat = ref.states[+st].actor, w = spec0.hands[seat][+hand][3]; let reach = w, prev = 0;
    for (const id of chain) { const par = ref.states[id].parent; if (ref.states[id].slot !== 7 && ref.states[par].actor === seat && ref.states[par].kind === 0) { const L = ref.states[par].length, rk = ref.rows.get(par + ':' + hand + ':' + (L >= 3 ? cards.split(',').slice(0, L).join(',') : '')); const a = rk && average(rk); reach *= a ? a[ref.states[id].slot] : 1 / ref.states[par].k; } prev = id; }
    assert.equal(item.reach, reach);
    E.renderExplorer(r, { kind: 'average', names: E.pfPositions(8), selectedCell: E.classOf(item.cards[0], item.cards[1]) });
    checked++;
  }
  assert.ok(checked >= 16, 'checked ' + checked);
});
test('3.8 explorer refuses unsolved branches, asks for chance cards, reports terminals, blockers and no EVs', t => {
  const dir = tmp(t), spec = specFile(dir, studies.sixFlop), state = path.join(dir, 's');
  mwcli([spec, 40, 2, state, 256]);
  const query = q => { const f = path.join(dir, 'q.json'); fs.writeFileSync(f, JSON.stringify(q)); const r = cp.spawnSync(tool(), ['--node', spec, state, f], { encoding: 'utf8' }); return r.status === 0 ? JSON.parse(r.stdout) : { error: r.stderr }; };
  const root = query({});
  assert.equal(root.node.street, 'flop'); assert.equal(root.ev.available, false); assert.ok(!('evs' in root.hands.items[0]));
  assert.ok(root.hands.items.every(h => !h.blocked), 'ranges exclude hands that overlap the study board');
  assert.match(query({ path: [7] }).error, /not in the solved abstraction/);
  // check through the flop to the turn chance node
  let path0 = [], r = root; while (r.node.kind === 'decision' && r.node.street === 'flop') { path0.push(0); r = query({ path: path0 }); }
  assert.equal(r.node.kind, 'chance'); assert.equal(r.node.needsCards, 1);
  assert.match(query({ path: [...path0, 0] }).error, /Select the next board card/);
  assert.match(query({ path: path0, board: [r.node.board[0]] }).error, /distinct/);
  const used = new Set(r.node.board), turn = [...Array(52).keys()].find(c => !used.has(c));
  const t2 = query({ path: path0, board: [turn] }); assert.equal(t2.node.street, 'turn'); assert.equal(t2.history.filter(h => h.chance).length, 1);
  const blocked = t2.hands.items.filter(h => h.blocked); assert.ok(blocked.length > 0 && blocked.every(h => h.reach === 0 && h.average === undefined && (h.cards.includes(turn))), 'turn card blocks combos');
  assert.equal(t2.aggregate.coverage.blocked, blocked.length);
  // a bet then folds around ends the hand
  let fold = query({ path: [1] }); const p2 = [1]; while (fold.node.kind === 'decision') { p2.push(0); fold = query({ path: p2 }); }
  assert.equal(fold.node.kind, 'terminal'); assert.ok(fold.node.pots.length >= 1);
  assert.ok(E.renderExplorer(fold, { kind: 'average' }).includes('Hand over'));
  const page = query({ offset: 10, limit: 7, rangeSeat: 2 }); assert.equal(page.hands.items.length, 7); assert.equal(page.hands.items[0].i, 10); assert.equal(page.hands.seat, 2);
});
test('3.8 explorer matrix aggregates combos, marks blocked classes and never shows strategies for missing rows', () => {
  const resp = { study: { players: 2, startStreet: 'river', abstraction: 'exact cards', weighting: 'linear', regretMatching: 'standard', tournament: false, updates: 1, sampledDeals: 1, rows: 1, states: 1 },
    node: { kind: 'decision', street: 'river', stateId: 0, visited: true, actor: 0, facing: false, price: 0, pot: 10, behind: [10, 10], live: [true, true], allIn: [false, false], effectiveStack: 10, board: [48, 49, 0, 4, 8] },
    history: [], actions: [{ slot: 0, name: 'Check', to: 0 }, { slot: 1, name: 'Bet to', to: 5 }], ev: { available: false, reason: 'none' },
    hands: { seat: 0, actingSeat: true, total: 3, offset: 0, items: [
      { i: 0, cards: [50, 51], weight: 1, blocked: false, reach: 1, average: [0.25, 0.75], current: [0, 1] },
      { i: 1, cards: [46, 47], weight: 1, blocked: false, reach: 3, average: [1, 0], current: [1, 0] },
      { i: 2, cards: [45, 44], weight: 1, blocked: false, reach: 1, average: null, current: null },
      { i: 3, cards: [48, 50], weight: 1, blocked: true, reach: 0 }] },
    aggregate: { rangeMass: 5, average: [0.8, 0.2], current: [0.75, 0.25], coverage: { hands: 4, blocked: 1, withRows: 2 } } };
  const cells = E.explorerMatrix(resp, 'average'), aa = cells[E.classOf(50, 51)], kk = cells[E.classOf(46, 47)];
  assert.equal(aa.combos.length, 2); assert.equal(aa.blocked, 1); assert.deepEqual(aa.mix, [0.25, 0.75]);
  assert.equal(kk.combos.length, 2); assert.equal(kk.missing, 1); assert.deepEqual(kk.mix, [1, 0]);
  const html = E.renderExplorer(resp, { kind: 'average', selectedCell: E.classOf(48, 50) }), kingHtml = E.renderExplorer(resp, { kind: 'average', selectedCell: E.classOf(46, 47) });
  assert.ok(html.includes('impossible: blocked by the board')); assert.ok(kingHtml.includes('no stored strategy')); assert.ok(!/\bEV\b\s*[-+]?\d/.test(html));
});
test('3.8 restore estimate matches live tables and refuses early with the numbers', t => {
  const dir = tmp(t), spec = specFile(dir, studies.icmFinal), state = path.join(dir, 's');
  mwcli([spec, 300, 2, state, 1024]);
  const ok = JSON.parse(mwcli(['--restore', spec, state, 1024]));
  const est = ok.restoreEstimate.totalBytes, cap = ok.tableCapacityBytes;
  assert.ok(Math.abs(est - cap) / cap < 0.02, est + ' vs ' + cap);
  for (const [mib, re] of [[2, /betting states alone/], [Math.ceil(est / 1048576 * 0.8), /needs an estimated \d+ MiB/]]) {
    const r = cp.spawnSync(tool(), ['--restore', spec, state, mib], { encoding: 'utf8' });
    assert.equal(r.status, 1); const out = JSON.parse(r.stdout); assert.equal(out.status, 503); assert.match(out.error, re);
  }
});
test('3.8 native host serves explorer nodes and refuses them while training', async t => {
  await withHost(home(t), {}, async api => {
    assert.equal((await api('mw/node', { path: [] })).status, 409);
    const spec = E.MultiwayGame(studies.threeRiver).nativeSpec();
    assert.equal((await api('mw/init', JSON.stringify(spec))).status, 200);
    assert.equal((await api('mw/train', { iterations: 3000, threads: 2 })).status, 200);
    const during = await api('mw/node', { path: [] });
    let s; do { await new Promise(r => setTimeout(r, 20)); s = await (await api('mw/status')).json(); } while (s.running);
    assert.ok(during.status === 409 || during.status === 200);
    const r = await api('mw/node', { path: [1] }); assert.equal(r.status, 200);
    const body = await r.json(); assert.equal(body.node.actor, 1); assert.equal(body.history[0].action, 'Bet to');
    const exported = parseState(Buffer.from(await (await api('mw/state')).arrayBuffer()));
    const st = body.node.stateId;
    for (const item of body.hands.items) { const v = exported.rows.get(st + ':' + item.i + ':' + E.parseBoard('Ks8d5h2c2s').slice(0, 3).sort((a, b) => a - b).map(c => c + 1).concat(E.parseBoard('Ks8d5h2c2s').slice(3).map(c => c + 1)).join(','));
      if (item.blocked) continue; assert.deepEqual(item.average, v ? average(v) : null); }
    assert.equal((await api('mw/node', 'nonsense')).status, 400);
    assert.equal((await api('mw/node-cancel', '')).status, 200);
  });
});
