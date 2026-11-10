'use strict';
// EightMax 3.9 regressions: strict explorer/EV/response-gain request
// validation, action-specific EVs against an INDEPENDENT JavaScript reference,
// sampled-EV uncertainty, exact best-response gains, cache invalidation, time
// limits and the desktop host endpoints.
//
// Independence of the reference: the reference below re-implements every EV
// operation in JavaScript - the opponent posterior (range weight x own average
// strategy on the path, card removal), expectation over later actions, runout
// enumeration, showdown with lib_eval.js, pot distribution with ties, chip
// utilities and ICM with lib_icm.js icmWithBusts() - and reads the stored
// average strategies with its own parser of the state file. It takes from the
// native engine only the betting-tree description of the 3.8 explorer (legal
// actions, amounts, committed chips, pot layers), whose betting rules are
// bit-identical to lib_river.js (3.8 parity tests). One hand-built heads-up
// game additionally hard-codes the betting tree and pot arithmetic.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
const E = require('../tools/loadlib');
for (const l of ['lib_runouts', 'lib_wide', 'lib_river', 'lib_pushfold', 'lib_explorer']) require('../web/' + l);
const { withHost, home } = require('./checkpoint_host');
const tool = () => process.env.EM_TEST_MWCLI || require('./native_build').cli().cli;
const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'em39-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const mwcli = (args, opts = {}) => cp.execFileSync(tool(), args.map(String), { encoding: 'utf8', maxBuffer: 64 << 20, ...opts });
const base = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128 };
const R3 = ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc'];
const studies = {
  huRiver: { ...base, board: 'Ks8d5h2c2s', common: 10, stacks: [20, 20], ranges: R3.slice(0, 2), streets: { river: { bets: '50,a', raises: 'a', maxBets: 2 } }, privateSeed: 3 },
  threeSide: { ...base, board: 'Ks8d5h2c2s', common: 6, stacks: [4, 12, 30], ranges: R3, streets: { river: { bets: '75,a', raises: 'a', maxBets: 2 } }, privateSeed: 5 },
  threeIcm: { ...base, board: 'Ks8d5h2c2s', common: 6, stacks: [4, 12, 30], ranges: R3, icm: { payouts: [50, 30, 20], others: [10] }, streets: { river: { bets: '75,a', raises: 'a', maxBets: 2 } }, privateSeed: 5 },
  huTurn: { ...base, board: 'Ks8d5h2c', common: 8, stacks: [12, 12], ranges: ['AhKh,KdQd,8s8h,JsTs', 'AsKd,5d5c,8h7h,JdTd'], streets: { turn: { bets: 'a', raises: '', maxBets: 1 }, river: { bets: '50', raises: '', maxBets: 1 } }, privateSeed: 7 },
  huSimple: { ...base, board: 'Ks8d5h2c2s', common: 10, stacks: [20, 20], ranges: R3.slice(0, 2), streets: { river: { bets: '50', raises: '', maxBets: 1 } }, privateSeed: 9 },
  bubble: { ...base, preflop: { mode: 'shove' }, dealt: 4, common: 0, board: '', stacks: [12, 7, 20, 4], ranges: Array(4).fill('random'), icm: { payouts: [50, 30, 20] }, batchDeals: 4, actionStreams: 'deal', privateSeed: 8 },
  icmFinal: { ...base, preflop: { mode: 'linked', opens: '2.2,a', raises: 'a', maxBets: 2 }, board: '', dealt: 8, common: 0, stacks: [30, 22, 15, 40, 9, 18, 25, 12], ranges: Array(8).fill('random'), icm: { payouts: [30, 20, 14, 11, 9, 7, 5, 4] }, streets: { flop: { bets: '50', raises: '', maxBets: 1 }, turn: { bets: 'a', raises: '', maxBets: 1 }, river: { bets: 'a', raises: '', maxBets: 1 } }, batchDeals: 4, actionStreams: 'deal', privateSeed: 4 },
};
function study(t, name, iterations, threads = 1) {
  const dir = tmp(t), spec = path.join(dir, 'spec.json'), state = path.join(dir, 'state');
  fs.writeFileSync(spec, JSON.stringify(E.MultiwayGame(studies[name]).nativeSpec()));
  mwcli([spec, iterations, threads, state, 512]);
  let qn = 0;
  const call = (mode, q) => { const f = path.join(dir, 'q' + (qn++) + '.json'); fs.writeFileSync(f, typeof q === 'string' ? q : JSON.stringify(q)); const r = cp.spawnSync(tool(), [mode, spec, state, f], { encoding: 'utf8', maxBuffer: 64 << 20 }); return r.status === 0 ? JSON.parse(r.stdout) : { error: r.stderr.trim() }; };
  return { dir, spec, state, specJson: JSON.parse(fs.readFileSync(spec, 'utf8')), node: q => call('--node', q), ev: q => call('--ev', q), gain: q => call('--gain', q), raw: call };
}
// ---- independent state parser (EMMW4 external-sampling layout, see v38) ----
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
// Spec hands are [id, a, b, weight]; the engine drops hands blocked by the study board (range index = position after dropping).
const rangesOf = spec => spec.hands.map(r => r.map(h => ({ a: h[1], b: h[2], w: h[3] })).filter(h => !spec.board.includes(h.a) && !spec.board.includes(h.b)));
const cardsKey = (board, len) => len < 3 ? '' : [...board.slice(0, 3).sort((a, b) => a - b), ...board.slice(3, len)].map(c => c + 1).join(',');
// ---- independent reference evaluator ----
// `dealt` is the list of cards dealt after the study board (the request
// format); full(dealt) is the complete public board used for keys and showdowns.
function reference(S, policyOf = null) {
  const st = parseState(fs.readFileSync(S.state)), spec = S.specJson, n = spec.n, cache = new Map();
  const hands = rangesOf(spec);
  const anteOf = spec.anteOf || Array(n).fill(0), icm = spec.icm || null;
  const full = dealt => [...spec.board, ...dealt];
  const node = (p, dealt) => { const key = p.join('.') + '|' + dealt.join('.'); if (!cache.has(key)) { const r = S.node({ path: p, board: dealt, limit: 1 }); if (r.error) throw Error(r.error + ' at ' + key); cache.set(key, r); } return cache.get(key); };
  const stored = (stateId, seat, h, board, len, k) => { const v = stateId >= 0 ? st.rows.get(stateId + ':' + h + ':' + cardsKey(board, len)) : null; return (v && average(v)) || Array(k).fill(1 / k); };
  // policy of `seat` holding range hand h at explorer node q (board: complete public cards at that node)
  const pol = (q, seat, h, board) => policyOf ? policyOf(q, seat, h, board) : stored(q.node.stateId, seat, h, board, streetLen(q.node.street), q.actions.length);
  const streetLen = s => s === 'preflop' ? 0 : s === 'flop' ? 3 : s === 'turn' ? 4 : 5;
  const holes = tuple => tuple.flatMap(h => [h.a, h.b]);
  // utility of `seat` at a terminal with a complete five-card board
  function utility(q, board, tuple, seat) {
    const win = Array(n).fill(0), score = tuple.map(h => E.evalCards([...board, h.a, h.b]));
    for (const pot of q.node.pots) { const e = pot.eligible; const top = Math.max(...e.map(p => score[p])); const w = e.filter(p => score[p] === top); for (const p of w) win[p] += pot.amount / w.length; }
    if (!icm) return win[seat] - q.node.committed[seat] - anteOf[seat];
    const final = q.node.behind.map((b, p) => b + win[p]);
    return E.icmWithBusts([...final, ...icm.others], icm.start, icm.payouts)[seat];
  }
  function terminal(q, board, tuple, seat) {
    if (!q.node.pots.some(p => p.eligible.length > 1) || board.length === 5) return utility(q, board, tuple, seat);
    const used = new Set([...board, ...holes(tuple)]); let s = 0, c = 0;
    const rec = (b, from) => { if (b.length === 5) { s += utility(q, b, tuple, seat); c++; return; } for (let x = from; x < 52; x++) if (!used.has(x)) rec([...b, x], x + 1); };
    rec(board.slice(), 0); return s / c;
  }
  // E[u_seat] below node (path, dealt) for a fixed hand tuple (range indices), every seat following its average strategy
  function value(p, dealt, idx, seat) {
    const q = node(p, dealt), tuple = idx.map((i, s) => hands[s][i]), board = full(dealt);
    if (q.node.kind === 'terminal') return terminal(q, board, tuple, seat);
    if (q.node.kind === 'chance' || q.node.needsCards) {
      const used = new Set([...board, ...holes(tuple)]); let s = 0, c = 0;
      for (let x = 0; x < 52; x++) if (!used.has(x)) { s += value(p, [...dealt, x], idx, seat); c++; }
      return s / c;
    }
    const k = q.actions.length, sg = pol(q, q.node.actor, idx[q.node.actor], board);
    let v = 0; for (let a = 0; a < k; a++) if (sg[a] > 0) v += sg[a] * value([...p, a], dealt, idx, seat);
    return v;
  }
  // reach weight of seat j's hand x at (path, dealt): weight x its own average probabilities on the path
  function reach(p, dealt, j, x) {
    const h = hands[j][x], board = full(dealt); if (board.includes(h.a) || board.includes(h.b)) return 0;
    let r = h.w, prefix = [], d = [];
    for (const a of p) {
      let q = node(prefix, d);
      while (q.node.kind === 'chance' || q.node.needsCards) { d = dealt.slice(0, d.length + 1); q = node(prefix, d); }
      if (q.node.actor === j) r *= pol(q, j, x, full(d))[a];
      prefix = [...prefix, a];
    }
    return r;
  }
  // exact action EVs of hand h of the acting seat at (path, dealt), plus opponent mass
  function actionEv(p, dealt, h) {
    const q = node(p, dealt), actor = q.node.actor, k = q.actions.length, own = hands[actor][h], board = full(dealt);
    const ev = Array(k).fill(0); let W = 0;
    const rec = (j, idx, used, w) => {
      if (j === n) { W += w; for (let a = 0; a < k; a++) ev[a] += w * value([...p, a], dealt, idx, actor); return; }
      if (j === actor) return rec(j + 1, idx, used, w);
      hands[j].forEach((x, i) => { if (used.has(x.a) || used.has(x.b)) return; const r = reach(p, dealt, j, i); if (!(r > 0)) return; const next = idx.slice(); next[j] = i; rec(j + 1, next, new Set([...used, x.a, x.b]), w * r); });
    };
    const idx = Array(n).fill(0); idx[actor] = h; rec(0, idx, new Set([...board, own.a, own.b]), 1);
    const sg = pol(q, actor, h, board);
    return { ev: ev.map(v => v / W), W, mix: sg.reduce((s, x, a) => s + x * ev[a] / W, 0), reach: reach(p, dealt, actor, h) };
  }
  // exact best-response gain of `seat` from the study root
  function bestResponse(seat) {
    let BR = 0, PV = 0, Z = 0;
    const brRec = (p, dealt, tuples, w, own) => {
      const q = node(p, dealt), board = full(dealt);
      if (q.node.kind === 'terminal') { let s = 0; tuples.forEach((t, i) => { if (w[i] > 0) { const idx = t.slice(); idx[seat] = own; s += w[i] * terminal(q, board, idx.map((x, j) => hands[j][x]), seat); } }); return [s, s]; }
      if (q.node.kind === 'chance' || q.node.needsCards) {
        const deck = 52 - board.length - 2 * n; let br = 0, pv = 0; const oh = hands[seat][own];
        for (let x = 0; x < 52; x++) {
          if (board.includes(x) || x === oh.a || x === oh.b) continue;
          const w2 = tuples.map((t, i) => t.some((y, j) => j !== seat && (hands[j][y].a === x || hands[j][y].b === x)) ? 0 : w[i] / deck);
          if (!w2.some(v => v > 0)) continue; const r = brRec(p, [...dealt, x], tuples, w2, own); br += r[0]; pv += r[1];
        }
        return [br, pv];
      }
      const k = q.actions.length, actor = q.node.actor;
      if (k === 1) return brRec([...p, 0], dealt, tuples, w, own);
      if (actor === seat) { const sg = pol(q, seat, own, board); let best = -Infinity, pv = 0; for (let a = 0; a < k; a++) { const r = brRec([...p, a], dealt, tuples, w, own); best = Math.max(best, r[0]); pv += sg[a] * r[1]; } return [best, pv]; }
      let br = 0, pv = 0;
      for (let a = 0; a < k; a++) { const wa = tuples.map((t, i) => w[i] > 0 ? w[i] * pol(q, actor, t[actor], board)[a] : 0); if (!wa.some(v => v > 0)) continue; const r = brRec([...p, a], dealt, tuples, wa, own); br += r[0]; pv += r[1]; }
      return [br, pv];
    };
    hands[seat].forEach((oh, h) => {
      if (!(oh.w > 0)) return;
      const tuples = [], ws = [];
      const rec = (j, idx, used, w) => { if (j === n) { tuples.push(idx.slice()); ws.push(w); return; } if (j === seat) return rec(j + 1, idx, used, w); hands[j].forEach((x, i) => { if (!(x.w > 0) || used.has(x.a) || used.has(x.b)) return; idx[j] = i; rec(j + 1, idx, new Set([...used, x.a, x.b]), w * x.w); }); };
      rec(0, Array(n).fill(0), new Set([...spec.board, oh.a, oh.b]), 1);
      if (!tuples.length) return;
      const r = brRec([], [], tuples, ws, h); BR += oh.w * r[0]; PV += oh.w * r[1]; Z += oh.w * ws.reduce((s, x) => s + x, 0);
    });
    return { gain: (BR - PV) / Z, br: BR / Z, pv: PV / Z };
  }
  return { actionEv, bestResponse, node, hands, st };
}
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), msg + ': ' + a + ' vs ' + b);
// Nodes of the tree (paths) up to a depth, decisions only.
function decisions(S, maxDepth, board = []) { const out = []; const rec = p => { const q = S.node({ path: p, board, limit: 1 }); if (q.error || q.node.kind !== 'decision') return; out.push(p); if (p.length < maxDepth) for (let a = 0; a < q.actions.length; a++) rec([...p, a]); }; rec([]); return out; }

// ============================== Priority 1 ==============================
test('3.9 explorer rejects malformed requests instead of coercing them (strings, null, negatives, fractions, oversize, unknown fields)', t => {
  const S = study(t, 'huRiver', 200);
  const ok = S.node({ path: [], limit: 1326 }); assert.equal(ok.node.kind, 'decision');
  const bad = [
    [{ rangeSeat: 'nonsense' }, /rangeSeat must be an integer, not a string/], [{ rangeSeat: '1' }, /rangeSeat must be an integer/], [{ rangeSeat: true }, /rangeSeat must be an integer, not a boolean/],
    [{ rangeSeat: 2 }, /rangeSeat must be from 0 to 1/], [{ rangeSeat: -1 }, /rangeSeat must be from 0 to 1/], [{ rangeSeat: 0.5 }, /whole number/], [{ rangeSeat: null }, /must not be null/],
    [{ offset: -1 }, /offset must be from 0/], [{ offset: '10' }, /offset must be an integer/], [{ offset: 2.5 }, /whole number/], [{ offset: 1e300 }, /offset must be from 0 to 1326/], [{ offset: 7 }, /past the end of the range/],
    [{ limit: 0 }, /limit must be from 1 to 1326/], [{ limit: 1327 }, /limit must be from 1/], [{ limit: 'all' }, /limit must be an integer/], [{ limit: [5] }, /not an array/], [{ limit: {} }, /not an object/],
    [{ path: 'nonsense' }, /path must be an array/], [{ path: [0, '1'] }, /path\[1\] must be an integer/], [{ path: [0.5] }, /whole number/], [{ path: [-1] }, /path\[0\] must be from 0 to 7/], [{ path: [8] }, /from 0 to 7/], [{ path: [null] }, /path\[0\] must be an integer, not null/],
    [{ path: Array(481).fill(0) }, /more than 480/], [{ path: [7] }, /not in the solved abstraction/], [{ path: [0, 0, 0, 0, 0] }, /past a terminal/],
    [{ board: [0] }, /Too many board cards/], [{ board: [52] }, /from 0 to 51/], [{ board: 'Ah' }, /board must be an array/],
    [{ foo: 1 }, /Unknown field "foo"/], ['{"limit":5,"limit":6}', /Duplicate field "limit"/], ['[1,2]', /must be a JSON object/], ['"x"', /must be a JSON object/], ['{"path":[0,]}', /Malformed JSON/], ['{"limit":NaN}', /Malformed JSON/], ['{"offset":1e999}', /Malformed JSON/],
    ['[' .repeat(70) + ']'.repeat(70), /Malformed JSON/], [{ stateId: 99 }, /stateId 99 does not match/], [{ stateId: 'x' }, /stateId must be an integer/], [{ studyId: 'not-this-study' }, /studyId does not match/], [{ studyId: 5 }, /studyId must be a string/],
  ];
  for (const [q, re] of bad) { const r = S.node(q); assert.ok(r.error, JSON.stringify(q) + ' was accepted'); assert.match(r.error, re, JSON.stringify(q)); assert.match(r.error, /^error (400|409|413):/, JSON.stringify(q)); }
  assert.match(S.node(JSON.stringify({ path: [], pad: 'x'.repeat(70000) })).error, /error 413: The request exceeds 64 KiB/);
  // valid requests keep working, including identifiers that match
  assert.equal(S.node({ path: [], stateId: 0, studyId: S.specJson.studyId, offset: 6, limit: 1 }).hands.items.length, 0);
  assert.equal(S.node({ rangeSeat: 1, offset: 2, limit: 3 }).hands.items[0].i, 2);
});
test('3.9 action-EV and response-gain requests are validated (hands, impossible cards, policies, limits, node kinds)', t => {
  const S = study(t, 'huTurn', 300);
  const bad = [
    [{}, /Give hands/], [{ hands: [] }, /Give hands/], [{ hands: 'all' }, /hands must be an array/], [{ hands: [0, 0] }, /twice/], [{ hands: [99] }, /not in the acting seat's range/], [{ hands: [0.5] }, /whole number/], [{ hands: Array(65).fill(0).map((_, i) => i) }, /more than 64/],
    [{ hands: [0], range: 'yes' }, /range must be true or false/], [{ hands: [0], policy: 'best' }, /policy must be one of: average, current/], [{ hands: [0], method: 'magic' }, /method must be one of/], [{ hands: [0], samples: 1 }, /samples must be from 16/], [{ hands: [0], samples: '100' }, /samples must be an integer/],
    [{ hands: [0], seed: -1 }, /seed must be from 0/], [{ hands: [0], seed: 2 ** 32 }, /seed must be from 0 to 4294967295/], [{ hands: [0], timeLimitMs: 5 }, /timeLimitMs must be from 100/], [{ hands: [0], maxVisits: 1e12 }, /maxVisits must be from 1000/], [{ hands: [0], missing: null }, /must not be null/],
    [{ hands: [0], path: [0, 0] }, /chance node: select the board card/], [{ hands: [0], path: [0, 0], board: [20, 20] }, /Too many board cards|distinct/],
  ];
  for (const [q, re] of bad) { const r = S.ev(q); assert.ok(r.error, JSON.stringify(q) + ' was accepted'); assert.match(r.error, re, JSON.stringify(q)); }
  // a hand that shares a card with a dealt river card is impossible
  const q0 = S.node({ path: [0, 0] }); const used = new Set(q0.node.board); const own = S.node({ path: [], limit: 1326 }).hands.items[0];
  assert.ok(!used.has(own.cards[1])); assert.match(S.ev({ path: [0, 0], board: [own.cards[1]], hands: [0] }).error, /impossible: it shares a card with the board/);
  for (const [q, re] of [[{ method: 'exact', seats: [5] }, /seats\[0\] must be from 0 to 1/], [{ seats: [0, 0] }, /twice/], [{ method: 'exact', path: [] , seats: [0] }, /start at the study root/], [{ path: [] }, /exactly one seat/], [{ samples: 10 }, /samples must be from 64/], [{ method: 'both' }, /method must be one of: exact, sampled/]]) {
    const r = S.gain(q); assert.ok(r.error, JSON.stringify(q)); assert.match(r.error, re, JSON.stringify(q));
  }
  // the explorer still reports that EVs are not stored and points to the EV endpoint
  const root = S.node({}); assert.equal(root.ev.available, false); assert.equal(root.ev.requested, false); assert.match(root.ev.reason, /api\/mw\/ev/);
});

// ============================== Priority 2 ==============================
test('3.9 exact action EVs equal the independent reference: heads-up river chip EV (check/bet/all-in, raise and call/fold nodes)', t => {
  const S = study(t, 'huRiver', 3000), ref = reference(S); let checked = 0;
  for (const p of decisions(S, 3)) {
    const q = S.node({ path: p, limit: 1326 }), hs = q.hands.items.filter(x => !x.blocked).map(x => x.i);
    const r = S.ev({ path: p, hands: hs, range: true, method: 'exact' });
    assert.equal(r.method, 'exact'); assert.equal(r.utility.model, 'chip'); assert.equal(r.actions.length, q.actions.length);
    let W = 0; const rev = Array(q.actions.length).fill(0);
    for (const h of r.hands) {
      const x = ref.actionEv(p, [], h.i);
      if (!(x.W > 0)) { assert.equal(h.available, false); continue; }
      for (let a = 0; a < x.ev.length; a++) close(h.ev[a], x.ev[a], 1e-9, 'path ' + p + ' hand ' + h.i + ' action ' + a);
      close(h.mixed, x.mix, 1e-9, 'mixed'); for (let a = 0; a < x.ev.length; a++) close(h.diff[a], x.ev[a] - x.mix, 1e-9, 'diff');
      close(h.opponentMass, x.W, 1e-12, 'opponent mass'); close(h.reach, x.reach, 1e-12, 'reach');
      for (let a = 0; a < x.ev.length; a++) close(h.fromDecision[a] - h.ev[a], r.sunk, 1e-12, 'sunk offset');
      W += x.reach * x.W; for (let a = 0; a < x.ev.length; a++) rev[a] += x.reach * x.W * x.ev[a]; checked++;
    }
    if (W > 0) for (let a = 0; a < rev.length; a++) close(r.range.ev[a], rev[a] / W, 1e-9, 'range EV ' + p);
    // the stored strategy is reported, never derived from EVs
    for (const h of r.hands) if (h.available) assert.ok(Math.abs(h.strategy.reduce((s, x) => s + x, 0) - 1) < 1e-9);
  }
  assert.ok(checked >= 30, 'checked ' + checked);
});
test('3.9 exact action EVs equal the independent reference: three-way river with unequal stacks and side pots (chip EV and ICM)', t => {
  for (const name of ['threeSide', 'threeIcm']) {
    const S = study(t, name, 1500), ref = reference(S); let checked = 0, sidePots = 0;
    for (const p of decisions(S, 4)) {
      const q = S.node({ path: p, limit: 1326 }); const hs = q.hands.items.filter(x => !x.blocked).map(x => x.i).slice(0, 3);
      const r = S.ev({ path: p, hands: hs, method: 'exact' }); assert.equal(r.utility.model, name === 'threeIcm' ? 'icm' : 'chip');
      for (const h of r.hands) { const x = ref.actionEv(p, [], h.i); if (!(x.W > 0)) continue; for (let a = 0; a < x.ev.length; a++) close(h.ev[a], x.ev[a], 1e-9, name + ' path ' + p + ' hand ' + h.i + ' a' + a); checked++; }
      for (let a = 0; a < q.actions.length; a++) { const c = S.node({ path: [...p, a] }); if (c.node.kind === 'terminal' && c.node.pots.length > 1) sidePots++; }
    }
    assert.ok(checked >= 20 && sidePots >= 1, name + ' checked ' + checked + ' side-pot terminals ' + sidePots);
    if (name === 'threeIcm') { const r = S.ev({ path: [], hands: [0], method: 'exact' }); assert.ok(r.hands[0].ev.every(v => v > 0 && v < 50), 'ICM equities are payout shares'); assert.ok(!('fromDecision' in r.hands[0])); }
  }
});
test('3.9 exact action EVs with a future street (turn study, river runouts, all-in on the turn) equal the reference', t => {
  const S = study(t, 'huTurn', 2000), ref = reference(S); let checked = 0;
  for (const p of [[], [0], [1]]) {
    const q = S.node({ path: p, limit: 1326 }); if (q.node.kind !== 'decision') continue;
    const hs = q.hands.items.filter(x => !x.blocked).map(x => x.i);
    const r = S.ev({ path: p, hands: hs, method: 'exact' });
    for (const h of r.hands) { const x = ref.actionEv(p, [], h.i); if (!(x.W > 0)) continue; for (let a = 0; a < x.ev.length; a++) close(h.ev[a], x.ev[a], 1e-9, 'turn path ' + p + ' hand ' + h.i); checked++; }
  }
  // a river decision after a dealt river card
  const river = S.node({ path: [0, 0] }); const card = [...Array(52).keys()].find(c => !river.node.board.includes(c) && c > 40);
  const rq = S.node({ path: [0, 0, 0], board: [card], limit: 1326 });
  const hs = rq.hands.items.filter(x => !x.blocked).map(x => x.i), r = S.ev({ path: [0, 0, 0], board: [card], hands: hs, method: 'exact' });
  for (const h of r.hands) { const x = ref.actionEv([0, 0, 0], [card], h.i); if (!(x.W > 0)) continue; for (let a = 0; a < x.ev.length; a++) close(h.ev[a], x.ev[a], 1e-9, 'river hand ' + h.i); checked++; }
  assert.ok(checked >= 8, 'checked ' + checked);
});
test('3.9 exact action EVs equal a hand-built heads-up river game (betting tree and pot arithmetic coded by hand)', t => {
  // common 10, stacks 20/20, one 50% bet (to 5), no raises: P0 check|bet5; after check P1 check|bet5 -> P0 fold|call; after bet P1 fold|call.
  const S = study(t, 'huSimple', 2500), st = parseState(fs.readFileSync(S.state)), spec = S.specJson, board = spec.board;
  const H = rangesOf(spec);
  const route = id => { const o = []; while (id !== 0) { o.push(st.states[id].slot); id = st.states[id].parent; } return o.reverse().join('.'); };
  const ids = new Map(st.states.map((s, i) => [route(i), i]));
  const sig = (r, h, k) => { const v = ids.has(r) ? st.rows.get(ids.get(r) + ':' + h + ':' + cardsKey(board, 5)) : null; return (v && average(v)) || Array(k).fill(1 / k); };
  const show = (i, j) => { const a = E.evalCards([...board, H[0][i].a, H[0][i].b]), b = E.evalCards([...board, H[1][j].a, H[1][j].b]); return a > b ? 1 : a < b ? 0 : 0.5; };
  const ev0 = (i, j) => { // values for P0 of each root action, P1 holding j
    const s1c = sig('0', j, 2), s0 = sig('0.1', i, 2), s1b = sig('1', j, 2), w = show(i, j);
    const check = s1c[0] * (10 * w) + s1c[1] * (s0[0] * 0 + s0[1] * (20 * w - 5));
    const bet = s1b[0] * 15 + s1b[1] * (20 * w) - 5;   // P1 folds: P0 takes the 10 common chips and its unmatched 5 back
    return [check, bet];
  };
  const opp = j => H[1][j].w;
  const hs = H[0].map((_, i) => i), r = S.ev({ path: [], hands: hs, method: 'exact' });
  assert.equal(r.actions.map(a => a.name).join(), 'Check,Bet to');
  for (const h of r.hands) {
    let W = 0, v = [0, 0];
    H[1].forEach((x, j) => { const o = H[0][h.i]; if ([o.a, o.b].includes(x.a) || [o.a, o.b].includes(x.b)) return; const e = ev0(h.i, j); W += opp(j); v[0] += opp(j) * e[0]; v[1] += opp(j) * e[1]; });
    close(h.ev[0], v[0] / W, 1e-9, 'check hand ' + h.i); close(h.ev[1], v[1] / W, 1e-9, 'bet hand ' + h.i);
  }
  // P1 facing a bet: P0's range is weighted by its probability of betting
  const r1 = S.ev({ path: [1], hands: H[1].map((_, j) => j), method: 'exact' });
  for (const h of r1.hands) {
    let W = 0, v = [0, 0];
    H[0].forEach((x, i) => { const o = H[1][h.i]; if ([o.a, o.b].includes(x.a) || [o.a, o.b].includes(x.b)) return; const w = x.w * sig('', i, 2)[1]; W += w; v[0] += w * 0; v[1] += w * (20 * (1 - show(i, h.i)) - 5); });
    if (!(W > 0)) continue; close(h.ev[0], v[0] / W, 1e-9, 'fold'); close(h.ev[1], v[1] / W, 1e-9, 'call hand ' + h.i);
    close(h.fromDecision[1], h.ev[1], 1e-12, 'nothing sunk before P1 acts');
  }
});
test('3.9 sampled EVs agree with exact EVs within their reported uncertainty (3 seeds, common random numbers, SE ~ 1/sqrt(N))', t => {
  const S = study(t, 'threeSide', 1500); let z = [], tested = 0;
  const q = S.node({ path: [], limit: 1326 }), hs = q.hands.items.filter(x => !x.blocked).map(x => x.i).slice(0, 4);
  const exact = S.ev({ path: [], hands: hs, range: true, method: 'exact' });
  for (const seed of [1, 2, 3]) {
    const s = S.ev({ path: [], hands: hs, range: true, method: 'sampled', futureActions: 'enumerate', samples: 4000, seed });
    assert.equal(s.method, 'sampled'); assert.equal(s.seed, seed);
    for (let i = 0; i < hs.length; i++) {
      const e = exact.hands[i], m = s.hands[i]; if (!e.available) continue; assert.equal(m.samples, 4000);
      for (let a = 0; a < e.ev.length; a++) { if (m.stdErr[a] > 0) z.push((m.ev[a] - e.ev[a]) / m.stdErr[a]); else close(m.ev[a], e.ev[a], 1e-9, 'zero-variance action'); assert.ok(m.ci95[a][0] <= m.ev[a] && m.ev[a] <= m.ci95[a][1]); tested++; }
      if (m.mixedStdErr > 0) z.push((m.mixed - e.mixed) / m.mixedStdErr);
    }
    for (let a = 0; a < exact.range.ev.length; a++) if (s.range.stdErr[a] > 0) z.push((s.range.ev[a] - exact.range.ev[a]) / s.range.stdErr[a]);
  }
  assert.ok(tested >= 20 && z.length >= 20, 'tested ' + tested);
  assert.ok(z.every(x => Math.abs(x) < 4.5), 'z-scores ' + z.map(x => x.toFixed(2)).join(' '));
  const within2 = z.filter(x => Math.abs(x) < 1.96).length / z.length; assert.ok(within2 > 0.8, 'coverage ' + within2);
  // standard error falls with the sample count; reproducible with a fixed seed
  const a1 = S.ev({ path: [], hands: [hs[0]], method: 'sampled', samples: 1000, seed: 9 }), a2 = S.ev({ path: [], hands: [hs[0]], method: 'sampled', samples: 16000, seed: 9 });
  const ratio = a1.hands[0].stdErr.map((x, i) => x / a2.hands[0].stdErr[i]).filter(Number.isFinite);
  assert.ok(ratio.every(r => r > 2.5 && r < 6.5), 'SE ratio ' + ratio);
  assert.deepEqual(S.ev({ path: [], hands: [hs[0]], method: 'sampled', samples: 1000, seed: 9 }).hands, a1.hands);
  // on-policy action sampling is also unbiased
  const sa = S.ev({ path: [], hands: [hs[0]], method: 'sampled', futureActions: 'sample', samples: 20000, seed: 4 });
  assert.equal(sa.futureActions, 'sampled from the policy');
  for (let a = 0; a < sa.actions.length; a++) if (sa.hands[0].stdErr[a] > 0) assert.ok(Math.abs(sa.hands[0].ev[a] - exact.hands[0].ev[a]) < 4.5 * sa.hands[0].stdErr[a], 'action sampling a' + a);
});
test('3.9 action EVs: current-policy mode, missing-row handling, equivalence flags and multiway preflop ICM (sampled, all actions)', t => {
  const S = study(t, 'huRiver', 1500), ref = reference(S);
  const cur = S.ev({ path: [], hands: [0], policy: 'current', method: 'exact' }); assert.equal(cur.policy, 'current'); assert.match(cur.policyNote, /CURRENT regret-matching/);
  const avg = S.ev({ path: [], hands: [0], method: 'exact' }); assert.equal(avg.policy, 'average'); assert.ok(avg.hands[0].ev.some((v, a) => v !== cur.hands[0].ev[a]), 'policies differ');
  const x = ref.actionEv([], [], 0); for (let a = 0; a < x.ev.length; a++) close(avg.hands[0].ev[a], x.ev[a], 1e-9, 'average');
  for (const h of avg.hands) { assert.ok(h.equivalentToBest[h.best]); const best = h.ev[h.best]; h.ev.forEach((v, a) => assert.equal(h.equivalentToBest[a], Math.abs(v - best) <= 1e-9 * Math.max(1, Math.abs(best)))); }
  // a very short study leaves unvisited rows: uniform substitution is reported, or refused on request
  const T = study(t, 'threeSide', 3);
  const deep = decisions(T, 3).find(p => p.length === 3) || [1, 1];
  const u = T.ev({ path: deep, hands: [0], method: 'exact' }), f = T.ev({ path: deep, hands: [0], method: 'exact', missing: 'refuse' });
  assert.ok(u.hands[0].fallbackShare.some(v => v > 0) || u.reachFallbackHands.some(v => v > 0), 'fallback is reported');
  assert.match(f.error, /error 422: Unavailable: .* no stored average strategy/);
  // eight-player final table, preflop: sampled, every legal action, ICM payout units, CIs
  const F = study(t, 'icmFinal', 40, 2), root = F.node({ limit: 1326 });
  const r = F.ev({ path: [], hands: [0, 100, 600], range: true, samples: 400, seed: 3 });
  assert.equal(r.method, 'sampled'); assert.equal(r.utility.model, 'icm'); assert.equal(r.actions.length, root.actions.length);
  for (const h of r.hands) { assert.equal(h.available, true); assert.equal(h.ev.length, root.actions.length); assert.ok(h.stdErr.every(Number.isFinite)); assert.ok(h.ev.every(v => v >= 0 && v <= 30)); }
  assert.ok(r.range.ev.every(Number.isFinite));
  // fold EV of a preflop open has no variance from the actor's own cards only if... it is a finished hand for this seat; check the label
  assert.equal(r.actions[0].name, 'Fold');
});
test('3.9 time limits stop sampling early and report the completed sample count', t => {
  const F = study(t, 'icmFinal', 20, 2);
  const r = F.ev({ path: [], hands: [5], samples: 2000000, timeLimitMs: 300, seed: 1 });
  assert.equal(r.stoppedEarly, true); assert.ok(r.hands[0].samples >= 16 && r.hands[0].samples < 2000000, String(r.hands[0].samples)); assert.ok(r.elapsedMs < 5000);
});

// ============================== Priority 3 ==============================
test('3.9 exact response gains equal an independent best-response computation (heads-up exploitability, three-way side pots, ICM)', t => {
  for (const [name, iters] of [['huRiver', 2000], ['threeSide', 800], ['threeIcm', 800], ['huTurn', 600]]) {
    const S = study(t, name, iters), ref = reference(S);
    const g = S.gain({ method: 'exact' }); assert.equal(g.method, 'exact'); assert.equal(g.seats.length, S.specJson.n);
    for (const s of g.seats) { const x = ref.bestResponse(s.seat); close(s.gain, x.gain, 1e-8, name + ' seat ' + s.seat); close(s.policyValue, x.pv, 1e-8, 'policy value'); assert.ok(s.gain >= -1e-9); }
    if (name.startsWith('hu')) { assert.ok(g.exploitability > 0); close(g.exploitability, (g.seats[0].gain + g.seats[1].gain) / 2, 1e-12, 'NashConv / 2'); }
    else { assert.equal(g.exploitability, null); assert.match(g.exploitabilityNote, /not two-player zero-sum/); }
    assert.equal(g.summary.seatsEvaluated, S.specJson.n);
  }
});
test('3.9 sampled one-shot response gains: independent selection/evaluation streams, per-seat reporting, bounded by the exact best response', t => {
  const S = study(t, 'huRiver', 1500);
  const exact = S.gain({ method: 'exact' }), s = S.gain({ method: 'sampled', samples: 20000, selectionSamples: 400, seed: 2 });
  assert.match(s.responseClass, /lower bound/);
  for (const seat of s.seats) {
    assert.equal(seat.available, true); assert.ok(seat.gain.stdErr > 0); const e = exact.seats.find(x => x.seat === seat.seat);
    assert.ok(seat.gain.mean - 4 * seat.gain.stdErr <= e.gain + 1e-9, 'one-shot gain exceeds the full best response: ' + seat.gain.mean + ' > ' + e.gain);
    assert.ok(seat.reachProbability.mean > 0 && seat.reachProbability.mean <= 1 + 1e-9);
  }
  // root decision of seat 0 is reached with probability 1
  close(s.seats[0].reachProbability.mean, 1, 1e-12, 'root reach');
  // eight-handed final table: every seat reported separately (no averaging away), ICM units, uncertainty
  const F = study(t, 'icmFinal', 40, 2), g = F.gain({ method: 'sampled', samples: 300, selectionSamples: 16, reachSamples: 2000, seed: 5, futureActions: 'sample' });
  assert.equal(g.seats.length, 8); assert.equal(g.utility.model, 'icm');
  for (const seat of g.seats) { assert.equal(seat.available, true, JSON.stringify(seat)); assert.ok(Number.isFinite(seat.gain.mean) && seat.gain.stdErr >= 0); assert.equal(seat.node.actor, seat.seat); }
  assert.equal(g.summary.seatsEvaluated, 8); assert.ok(g.summary.maxSeatGain >= g.summary.meanSeatGain);
  // the big blind's first decision needs a call from the small blind on the default path
  assert.ok(g.seats[7].node.path.length >= 7);
  // exact on a preflop study is refused with a clear message rather than running for hours
  assert.match(F.gain({ method: 'exact', seats: [0], maxVisits: 100000 }).error, /error 422: Exact best response exceeds maxVisits/);
});

// ============================== Priority 5 ==============================
test('3.9 Compact and Detailed hand groups: explorer strategies equal the JavaScript group mapping, and grouped-study action EVs equal the reference (river and turn)', t => {
  for (const [abstraction, board, streets] of [['compact', 'Ks8d5h2c2s', { river: { bets: '50,a', raises: 'a', maxBets: 2 } }], ['detailed', 'Ks8d5h2c2s', { river: { bets: '50,a', raises: 'a', maxBets: 2 } }],
    ['compact', 'Ks8d5h2c', { turn: { bets: 'a', raises: '', maxBets: 1 }, river: { bets: '50', raises: '', maxBets: 1 } }], ['detailed', 'Ks8d5h2c', { turn: { bets: '75', raises: '', maxBets: 1 }, river: { bets: '50', raises: '', maxBets: 1 } }]]) {
    const name = 'grouped-' + abstraction + board.length; studies[name] = { ...base, abstraction, board, common: 10, stacks: [20, 20], ranges: ['QQ+,AKs,AQs,98s', 'JJ+,AKs,KQs,76s'], streets, privateSeed: 3 };
    const S = study(t, name, 1500), g = E.MultiwayGame(studies[name]); g.iterate(1500);   // JavaScript training is bit-identical (3.3/3.8 parity)
    const H = S.specJson.hands.map(r => r.filter(h => !S.specJson.board.includes(h[1]) && !S.specJson.board.includes(h[2])).map(h => ({ id: h[0], a: h[1], b: h[2] })));
    assert.ok(H[0].length > 12, 'ranges must exceed 12 combos so the starting street is grouped, not per hand');
    const jsPath = q => 'r' + q.history.map(h => h.chance ? 'c' : h.slot).join('');
    const jsPolicy = (q, seat, h, full) => { const v = g.averageAt(jsPath(q), full, seat, H[seat][h]); return v ? Array.from(v) : Array(q.actions.length).fill(1 / q.actions.length); };
    let checked = 0, zeroRows = 0;
    const visit = (p, dealt, depth) => {
      const r = S.node({ path: p, board: dealt, limit: 1326 });
      if (r.node.kind === 'chance') { if (dealt.length) return; const used = new Set(r.node.board); for (const c of [0, 13, 26, 51]) if (!used.has(c)) visit(p, [...dealt, c], depth); return; }
      if (r.node.kind !== 'decision') return;
      for (const it of r.hands.items) { if (it.blocked) continue; const js = g.averageAt(jsPath(r), r.node.board, r.node.actor, H[r.node.actor][it.i]); checked++;
        if (it.average) assert.deepEqual(Array.from(js), it.average, abstraction + ' ' + jsPath(r) + ' hand ' + it.i);
        else { assert.ok(!js || (it.row && js.every(x => x === 1 / js.length))); zeroRows++; } }   // no row on either side, or a stored row with zero average sums (uniform in JS, "no stored strategy" natively)
      if (depth < 3) for (let a = 0; a < r.actions.length; a++) visit([...p, a], dealt, depth + 1);
    };
    visit([], [], 0);
    assert.ok(checked >= 200, abstraction + ' checked ' + checked);
    // grouped strategies are shared by the hands of a group, but EVs are computed per exact hand
    const ref = reference(S, jsPolicy), q = S.node({ path: [], limit: 1326 }), hs = q.hands.items.filter(x => !x.blocked).map(x => x.i).slice(0, 10);
    const r = S.ev({ path: [], hands: hs, method: 'exact' }); let distinct = new Set();
    for (const h of r.hands) { const x = ref.actionEv([], [], h.i); for (let a = 0; a < x.ev.length; a++) close(h.ev[a], x.ev[a], 1e-9, abstraction + ' hand ' + h.i); distinct.add(h.ev.map(v => v.toFixed(9)).join()); }
    assert.ok(distinct.size > 1, 'EVs differ between hands even where they share a group strategy');
    const groups = new Map(); for (const it of q.hands.items) if (!it.blocked) { const k = it.key.hand + ':' + it.key.code; groups.set(k, (groups.get(k) || 0) + 1); }
    assert.ok([...groups.values()].some(c => c > 1), abstraction + ': some hands share a group row');
  }
});

// ============================== host ==============================
test('3.9 native host: /api/mw/ev and /api/mw/response-gain, HTTP 400 for malformed input, cache invalidated by training', async t => {
  await withHost(home(t), {}, async api => {
    assert.equal((await api('mw/ev', { hands: [0] })).status, 409);
    const spec = E.MultiwayGame(studies.huRiver).nativeSpec();
    assert.equal((await api('mw/init', JSON.stringify(spec))).status, 200);
    assert.equal((await api('mw/train', { iterations: 500, threads: 1 })).status, 200);
    let s; do { await new Promise(r => setTimeout(r, 20)); s = await (await api('mw/status')).json(); } while (s.running);
    for (const [route, body] of [['mw/node', { rangeSeat: 'nonsense' }], ['mw/node', { offset: -5 }], ['mw/node', { limit: '7' }], ['mw/node', '{"path":[0],'], ['mw/node', { path: [0, 0, 0, 0, 0, 0] }],
      ['mw/ev', { hands: ['0'] }], ['mw/ev', { hands: [0], samples: 1.5 }], ['mw/ev', { hands: [0], board: [3] }], ['mw/ev', 'null'], ['mw/response-gain', { seats: ['x'] }], ['mw/response-gain', { bogus: 1 }]]) {
      const r = await api(route, body); assert.equal(r.status, 400, route + ' ' + JSON.stringify(body)); const text = await r.text(); assert.ok(!/"hands"|"node"/.test(text), 'no strategy page for a malformed request');
    }
    const q = { path: [], hands: [0, 1], method: 'exact' };
    const a = await (await api('mw/ev', q)).json(), b = await (await api('mw/ev', q)).json();
    assert.equal(a.cache.hit, false); assert.equal(b.cache.hit, true); assert.deepEqual(b.hands, a.hands);
    assert.equal((await api('mw/train', { iterations: 300, threads: 1 })).status, 200);
    do { await new Promise(r => setTimeout(r, 20)); s = await (await api('mw/status')).json(); } while (s.running);
    const c = await (await api('mw/ev', q)).json(); assert.equal(c.cache.hit, false); assert.notDeepEqual(c.hands.map(h => h.ev), a.hands.map(h => h.ev));
    const g = await api('mw/response-gain', { method: 'exact' }); assert.equal(g.status, 200); assert.ok((await g.json()).exploitability > 0);
  });
});
test('3.9 explorer renders requested EVs, uncertainty and EV matrix modes without inventing values', () => {
  const resp = { study: { players: 2, startStreet: 'river', abstraction: 'exact cards', weighting: 'linear', regretMatching: 'standard', tournament: false, updates: 1, sampledDeals: 1, rows: 1, states: 1 },
    node: { kind: 'decision', street: 'river', stateId: 0, visited: true, actor: 0, facing: false, price: 0, pot: 10, behind: [10, 10], live: [true, true], allIn: [false, false], effectiveStack: 10, board: [48, 49, 0, 4, 8] },
    history: [], actions: [{ slot: 0, name: 'Check', to: 0 }, { slot: 1, name: 'Bet to', to: 5 }], ev: { available: false, reason: 'none' },
    hands: { seat: 0, actingSeat: true, total: 3, offset: 0, items: [
      { i: 0, cards: [50, 51], weight: 1, blocked: false, reach: 1, average: [0.25, 0.75], current: [0, 1] },
      { i: 1, cards: [46, 47], weight: 1, blocked: false, reach: 3, average: [1, 0], current: [1, 0] },
      { i: 2, cards: [45, 44], weight: 1, blocked: false, reach: 1, average: null, current: null }] },
    aggregate: { rangeMass: 5, average: [0.8, 0.2], current: [0.75, 0.25], coverage: { hands: 3, blocked: 0, withRows: 2 } } };
  const ev = { method: 'sampled', policy: 'average', utility: { model: 'chip', unit: 'BB', convention: 'x' }, actions: resp.actions, futureActions: 'enumerated', seed: 1, stoppedEarly: false,
    hands: [{ i: 0, cards: [50, 51], available: true, method: 'sampled', samples: 1000, ev: [1.5, 2.25], stdErr: [0.1, 0.2], ci95: [[1.3, 1.7], [1.86, 2.64]], mixed: 2.06, mixedStdErr: 0.1, diff: [-0.56, 0.19], diffStdErr: [0.05, 0.05], best: 1, equivalentToBest: [false, true], fallbackShare: [0, 0], strategy: [0.25, 0.75], reach: 1 },
      { i: 1, available: false, method: 'sampled', reason: 'Too few samples' }], range: null };
  const html = E.renderExplorer(resp, { kind: 'average', selectedCell: E.classOf(50, 51), ev, matrixMode: 'ev', evAction: 1 });
  assert.ok(html.includes('2.25') && html.includes('±') && html.includes('sampled'), 'EV table shows values with uncertainty');
  assert.ok(E.renderExplorer(resp, { kind: 'average', ev }).includes('EV unavailable: Too few samples'), 'unavailable EVs are labelled');
  const cells = E.explorerEvMatrix(resp, ev, 1, 'ev');
  assert.equal(cells[E.classOf(50, 51)].value, 2.25); assert.equal(cells[E.classOf(46, 47)].value, null, 'no EV is shown for a class without computed combos');
  const d = E.explorerEvMatrix(resp, ev, 1, 'diff'); close(d[E.classOf(50, 51)].value, 0.19, 1e-12, 'diff mode');
  const u = E.explorerEvMatrix(resp, ev, 1, 'stderr'); close(u[E.classOf(50, 51)].value, 0.2, 1e-12, 'uncertainty mode');
  // no EV request: still no numbers labelled EV
  assert.ok(!/\bEV\b\s*[-+]?\d/.test(E.renderExplorer(resp, { kind: 'average' })));
});
