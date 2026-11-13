'use strict';
// EightMax 4.4 (Priority 6): multiway postflop and tournament accuracy checks
// with up to six players after the flop and eight before it.
//
// Scenarios (small explicit ranges so that EXACT evaluation is tractable):
//   flop6      six-player flop, stacks 3-50 bb, earlier wagers and folded money,
//              all-in or fold (multiway all-ins, five side pots possible)
//   flop6bets  the same six seats with two bet sizes, raises, turn and river
//              (rules walk only: exact evaluation of this tree is too large)
//   flop5      five-player flop, weighted ranges, short stacks
//   turn4      four-player turn + river, two bet sizes, raises, side pots
//   river3     three-player river, side pots (chip EV) and the same with ICM
//   huTurn     heads-up turn + river;  huRiver  heads-up river, three bet
//              sizes, two raise sizes, weighted ranges
//   bubble4    four-player ICM bubble push/fold, weighted ranges, 4 bb stack
//   final8     eight-player final-table ICM push/fold (validation/4.0 fixture)
//
// A. RULES WALK. The explorer (mwcli --node) is walked from the root through
//    decision and chance nodes and every node is checked against rules written
//    here independently of the engine:
//      chips      pot = starting pot + all wagers; stack = behind + wagers (+ ante)
//      actors     the actor is live and not all-in; folded seats stay folded
//      actions    fold only when facing a bet; check only when not; a call
//                 costs min(price, stack); every bet/raise is above the price
//                 and within the stack; "All-in" is exactly the stack; a
//                 non-all-in raise is at least the previous raise (minimum raise)
//      transitions the child's pot, wagers and live flags follow from the action
//      chance     a street change deals 1 (or 3) new distinct cards, resets
//                 street wagers and keeps the pot
//      strategies every stored average and current strategy sums to 1; hands
//                 that share a card with the board are blocked; range weights
//                 are the weights of the specification
// B. VALUE CHECKS (exact evaluation, independent paths compared):
//      conservation   chip EV: the seats' policy values sum to the starting
//                     pot; ICM with every player at the table: to the prize pool
//      two evaluators the root actor's policy value from the best-response
//                     evaluator equals the range-aggregate mixed EV from the
//                     action-EV evaluator (different code paths)
//      two methods    shared showdown tables vs per-board enumeration
//                     (EM_EV_NO_TABLES): relative 1e-12; 1 vs 4 threads: bits
//      response gain  every exact unilateral gain is >= 0 and bit-identical
//                     for 1 and 4 threads
//      sampling       a sampled estimate lies within 5 standard errors of the
//                     exact value (weighted ranges, chance probabilities)
// These establish correctness of the engine WITHIN each betting abstraction and
// range set; they say nothing about unrestricted poker.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
const E = require('../tools/loadlib');
for (const l of ['lib_runouts', 'lib_wide', 'lib_river', 'lib_pushfold', 'lib_explorer']) require('../web/' + l);
const build = require('./native_build');
const tool = () => process.env.EM_TEST_MWCLI || build.cli().cli;
const skip = !tool() && (build.cli().why || 'no native CLI');
const fixtures40 = path.join(__dirname, '..', '..', 'validation', '4.0', 'fixtures');
const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'em44p-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const base = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128 };
const SIX = { board: 'Td7c2h', dealt: 8, common: 1.5, stacks: [20, 35, 8, 50, 14, 3], prior: Array(6).fill(2.5), folded: [1, 2.5], ranges: ['AhTh,7s7d', 'KdTs,9c8c', 'QsQd,Ac7h', 'JhTc,6s5s', 'AdKc,2s2d', '8h8d,As2c'] };
const R3 = ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc'];
const scenarios = {
  flop6: { ...SIX, streets: { flop: { bets: 'a', raises: '', maxBets: 1 } } },
  flop6bets: { ...SIX, streets: { flop: { bets: '33,a', raises: '3x,a', maxBets: 3 }, turn: { bets: '50,a', raises: 'a', maxBets: 1 }, river: { bets: 'a', raises: '', maxBets: 1 } } },
  flop5: { board: 'Qs9h4d', dealt: 8, common: 1.5, stacks: [9, 26, 40, 15, 6], prior: Array(5).fill(2.2), folded: [1, 2.2, 2.2], ranges: ['AsQd:0.75,9c9d', 'KsQh,JhTh:0.5', '4s4c,AdKd', 'QcJc:0.6,8s7s', 'AhAc,Td9d:0.4'], streets: { flop: { bets: 'a', raises: '', maxBets: 1 } } },
  turn4: { board: 'Qh9c4d2s', common: 8, stacks: [6, 14, 25, 40], ranges: ['AhQs,9h9d,KcJc', 'Kh9s,4h4c,JdTd', 'AcAd,Qc8c,7s6s', 'QdJh,5d3d,Ks2h'], streets: { turn: { bets: '50,a', raises: 'a', maxBets: 2 }, river: { bets: '75,a', raises: 'a', maxBets: 1 } } },
  river3: { board: 'Ks8d5h2c2s', common: 6, stacks: [4, 12, 30], ranges: R3, streets: { river: { bets: '75,a', raises: 'a', maxBets: 2 } } },
  river3icm: { board: 'Ks8d5h2c2s', common: 6, stacks: [4, 12, 30], ranges: R3, icm: { payouts: [50, 30, 20], others: [10] }, streets: { river: { bets: '75,a', raises: 'a', maxBets: 2 } } },
  huTurn: { board: 'Ks8d5h2c', common: 8, stacks: [12, 12], ranges: ['AhKh,KdQd,8s8h,JsTs', 'AsKd,5d5c,8h7h,JdTd'], streets: { turn: { bets: 'a', raises: '', maxBets: 1 }, river: { bets: '50', raises: '', maxBets: 1 } } },
  huRiver: { board: 'Ks8d5h2c2s', common: 10, stacks: [20, 20], ranges: ['AhKh,KdQd:0.5,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c:0.25,8h7h,AdQd,JdTd'], streets: { river: { bets: '33,75,a', raises: '2.5x,a', maxBets: 3 } } },
  bubble4: { preflop: { mode: 'shove' }, dealt: 4, common: 0, board: '', stacks: [12, 7, 20, 4], ranges: ['AsAh,7c2d:0.5', 'KsKh:0.75,8c3d', 'QsQh,6d5d', 'JsJh:0.5,9s8s'], icm: { payouts: [50, 30, 20] }, batchDeals: 4, actionStreams: 'deal' },
};
const cache = new Map();
function study(t, name, iterations = 300) {
  if (cache.has(name)) return cache.get(name);
  let dir, spec, state, specJson;
  if (name === 'final8') { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em44p-')); spec = path.join(fixtures40, 'push8-icm.spec.json'); state = path.join(fixtures40, 'push8-icm.state'); specJson = JSON.parse(fs.readFileSync(spec, 'utf8')); }
  else {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em44p-')); spec = path.join(dir, 'spec.json'); state = path.join(dir, 'state');
    specJson = E.MultiwayGame({ ...base, ...scenarios[name], privateSeed: 3 }).nativeSpec(); fs.writeFileSync(spec, JSON.stringify(specJson));
    cp.execFileSync(tool(), [spec, iterations, 2, state, 512].map(String), { encoding: 'utf8' });
  }
  let n = 0;
  const run = (mode, q, env = {}) => {
    const f = path.join(dir, 'q' + (n++ % 4) + '.json'); fs.writeFileSync(f, JSON.stringify(q));
    const r = cp.spawnSync(tool(), [mode, spec, state, f], { encoding: 'utf8', maxBuffer: 1 << 27, env: { ...process.env, ...env }, timeout: 600000 });
    return { json: r.status === 0 ? JSON.parse(r.stdout) : null, error: (r.stderr || '').trim() };
  };
  const S = { name, dir, spec: specJson, run, node: q => run('--node', q), ev: (q, env) => run('--ev', q, env), gain: (q, env) => run('--gain', q, env) };
  cache.set(name, S); return S;
}
test.after(() => { for (const S of cache.values()) fs.rmSync(S.dir, { recursive: true, force: true }); });
const sum = a => a.reduce((x, y) => x + y, 0);
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
const rel = (a, b) => Math.abs(a - b) / Math.max(1, Math.abs(b));
const cardsOf = h => h.cards;

// ---- A. independent rules walk ----
// Walks up to `limit` nodes breadth-first (every action at shallow depth, then a deterministic subset).
function walk(S, limit) {
  const R = S.spec.rules, n = S.spec.n, stats = { nodes: 0, decisions: 0, chance: 0, actions: 0, raises: 0, allIns: 0, folds: 0, streets: new Set(), strategies: 0, blocked: 0, maxLive: 0, minRaiseChecked: 0, shortAllInRaises: 0 };
  const queue = [{ path: [], board: [], parent: null, action: null, lastRaise: 0, prevPrice: 0 }]; let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
  const where = (q, msg) => S.name + ' path [' + q.path.join(',') + '] board [' + q.board.join(',') + ']: ' + msg;
  let root = null;
  // two queues: `queue` is breadth-first from the root, `deep` follows street changes; they alternate so both are covered
  const deep = [];
  // the passive line (check, or call when facing) reaches the next street in the fewest actions: walk it first
  for (let pp = [], i = 0; i < 16; i++) {
    const j = S.node({ path: pp, board: [], limit: 1 }).json; if (!j || j.node.kind !== 'decision') break;
    const x = j.actions[j.node.facing ? 1 : 0]; pp = [...pp, x.slot];
    if (x.leadsTo !== 'decision') { if (x.leadsTo === 'chance') deep.push({ path: pp, board: [], parent: null, action: null, lastRaise: 0, prevPrice: 0, deep: true }); break; }
  }
  while ((queue.length || deep.length) && stats.nodes < limit) {
    const q = (deep.length && (stats.nodes % 2 === 1 || !queue.length)) ? deep.shift() : queue.shift(); const r = S.node({ path: q.path, board: q.board, limit: 1326 });
    assert.ok(r.json, where(q, r.error)); const j = r.json, nd = j.node; stats.nodes++;
    if (nd.kind === 'chance') {   // the path stops at a chance node: deal distinct cards and continue
      stats.chance++; const used = new Set(nd.board); const need = nd.board.length === 0 ? 3 : 1, cards = [];
      for (let c = Math.floor(rnd() * 52); cards.length < need; c = (c + 7) % 52) if (!used.has(c)) { used.add(c); cards.push(c); }
      deep.unshift({ ...q, board: [...q.board, ...cards], parent: nd, action: 'chance', dealt: cards, lastRaise: 0, prevPrice: 0 }); continue;   // follow the new street next
    }
    assert.equal(nd.kind, 'decision', where(q, 'kind ' + nd.kind)); stats.decisions++; stats.streets.add(nd.street);
    if (!root) root = nd;
    const a = nd.actor, put = nd.streetPut, behind = nd.behind, cap = put[a] + behind[a];
    // chips
    assert.ok(near(nd.pot - sum(nd.committed), root.pot - sum(root.committed)), where(q, 'pot ' + nd.pot + ' != starting pot + wagers ' + sum(nd.committed)));
    assert.ok(near(nd.pot, R.pot0 + sum(nd.committed)), where(q, 'pot ' + nd.pot + ' vs rules.pot0 ' + R.pot0 + ' + wagers'));   // pot0: antes, earlier wagers, folded and dead money
    for (let p = 0; p < n; p++) {
      assert.ok(near(behind[p] + nd.committed[p], R.stacks[p]), where(q, 'seat ' + p + ': behind ' + behind[p] + ' + wagers ' + nd.committed[p] + ' != stack ' + R.stacks[p]));
      assert.ok(behind[p] >= -1e-12 && put[p] >= -1e-12 && nd.committed[p] >= put[p] - 1e-12, where(q, 'negative chips'));
      assert.equal(nd.allIn[p], nd.live[p] && behind[p] <= 1e-12, where(q, 'allIn flag of seat ' + p));
    }
    // actor and price
    assert.ok(nd.live[a] && behind[a] > 1e-12, where(q, 'actor ' + a + ' must be live with chips'));
    const price = Math.max(...put.filter((_, p) => nd.live[p] || put[p] > 0));
    assert.ok(near(nd.price, Math.max(...put)), where(q, 'price ' + nd.price + ' vs highest street wager ' + Math.max(...put))); void price;
    assert.equal(nd.facing, nd.price > put[a] + 1e-12, where(q, 'facing'));
    stats.maxLive = Math.max(stats.maxLive, nd.live.filter(Boolean).length);
    // board
    assert.equal(new Set(nd.board).size, nd.board.length, where(q, 'duplicate board card')); assert.ok(nd.board.every(c => Number.isInteger(c) && c >= 0 && c < 52));
    assert.equal(nd.board.length, { preflop: 0, flop: 3, turn: 4, river: 5 }[nd.street], where(q, 'street/board length'));
    // transition from the parent
    if (q.parent && q.action === 'chance') {
      assert.ok(near(nd.pot, q.parent.pot), where(q, 'pot changed across a chance node')); assert.ok(put.every(x => x === 0), where(q, 'street wagers reset'));
      for (const c of q.dealt) assert.ok(nd.board.includes(c));
      assert.deepEqual(nd.live, q.parent.live); for (let p = 0; p < n; p++) assert.ok(near(nd.committed[p], q.parent.committed[p]));
    } else if (q.parent) {
      const P = q.parent, pa = P.actor, act = q.action, sameStreet = nd.street === P.street;
      for (let p = 0; p < n; p++) {
        if (p !== pa) { assert.ok(near(nd.committed[p], P.committed[p]), where(q, 'seat ' + p + ' wagers changed by another seat\'s action')); assert.equal(nd.live[p], P.live[p]); }
      }
      if (act.name === 'Fold') { assert.equal(nd.live[pa], false, where(q, 'folded seat still live')); assert.ok(near(nd.committed[pa], P.committed[pa])); assert.ok(near(nd.pot, P.pot)); }
      else {
        const delta = act.name === 'Check' ? 0 : act.to - P.streetPut[pa];
        assert.ok(delta >= -1e-12, where(q, 'negative wager')); assert.ok(near(nd.committed[pa], P.committed[pa] + delta), where(q, 'wager of ' + act.name + ' to ' + act.to));
        assert.ok(near(nd.pot, P.pot + delta), where(q, 'pot after ' + act.name)); assert.equal(nd.live[pa], true);
        if (sameStreet) assert.ok(near(put[pa], P.streetPut[pa] + delta));
      }
    }
    // actions
    const acts = j.actions; assert.ok(acts.length >= 1 && acts.length <= 8); acts.forEach((x, i) => assert.equal(x.slot, i));
    const names = acts.map(x => x.name);
    if (nd.facing) {
      assert.equal(names[0], 'Fold', where(q, 'facing a bet: first action')); assert.ok(!names.includes('Check'));
      // push/fold trees (rules.shove): facing only the blinds the choice is fold or all-in; facing an all-in it is fold or call
      if (R.shove && names[1] === 'All-in') assert.equal(acts.length, 2, where(q, 'push/fold: fold or all-in'));
      else { assert.equal(names[1], 'Call', where(q, 'second action facing a bet')); assert.ok(near(acts[1].to, Math.min(nd.price, cap)), where(q, 'call to ' + acts[1].to + ' vs min(price ' + nd.price + ', stack ' + cap + ')')); }
    }
    else { assert.equal(names[0], 'Check', where(q, 'not facing: first action')); assert.ok(!names.includes('Fold') && !names.includes('Call'), where(q, 'fold/call offered without a bet')); }
    let prevTo = nd.price;
    for (const x of acts) {
      stats.actions++;
      if (x.name === 'Fold') { stats.folds++; continue; } if (x.name === 'Check' || x.name === 'Call') continue;
      stats.raises++;
      assert.ok(x.to > nd.price + 1e-12, where(q, x.name + ' to ' + x.to + ' is not above the price ' + nd.price));
      assert.ok(x.to <= cap + 1e-9, where(q, x.name + ' to ' + x.to + ' exceeds the stack ' + cap));
      assert.ok(x.to > prevTo - 1e-12, where(q, 'sizes not increasing')); prevTo = x.to;
      if (x.name === 'All-in') { stats.allIns++; assert.ok(near(x.to, cap), where(q, 'All-in to ' + x.to + ' vs stack ' + cap)); if (nd.facing && x.to - nd.price < q.lastRaise - 1e-9) stats.shortAllInRaises++; }
      else {
        assert.ok(x.to < cap - 1e-9, where(q, x.name + ' equals the stack but is not named All-in'));
        // minimum raise: a non-all-in raise is at least the last full raise of the street (a bet at least the big blind when one is defined)
        if (nd.facing && q.lastRaise > 0) { stats.minRaiseChecked++; assert.ok(x.to - nd.price >= q.lastRaise - 1e-9, where(q, x.name + ' to ' + x.to + ': raise ' + (x.to - nd.price) + ' below the previous raise ' + q.lastRaise)); }
      }
    }
    // strategies and blockers
    const H = j.hands; assert.equal(H.seat, a);
    const specHands = S.spec.hands[a];
    for (const h of H.items) {
      const cs = cardsOf(h), blocked = cs.some(c => nd.board.includes(c)); assert.equal(h.blocked, blocked, where(q, 'blocker flag of hand ' + h.i)); if (blocked) stats.blocked++;
      if (specHands && specHands[h.i] && typeof specHands[h.i].w === 'number') assert.ok(near(h.weight, specHands[h.i].w), where(q, 'range weight'));
      assert.ok(h.weight > 0 && h.weight <= 1 + 1e-12);
      for (const kind of ['average', 'current']) if (Array.isArray(h[kind])) {
        stats.strategies++; assert.equal(h[kind].length, acts.length);
        assert.ok(h[kind].every(x => x >= -1e-12 && x <= 1 + 1e-12), where(q, kind + ' strategy outside [0,1]'));
        assert.ok(Math.abs(sum(h[kind]) - 1) < 1e-9, where(q, kind + ' strategy of hand ' + h.i + ' sums to ' + sum(h[kind])));
      }
    }
    if (Array.isArray(j.aggregate.average)) assert.ok(Math.abs(sum(j.aggregate.average) - 1) < 1e-9, where(q, 'aggregate strategy'));
    // children: all of them near the root, then a deterministic subset
    for (const x of acts) {
      if (x.leadsTo === 'terminal') continue;
      if (q.path.length >= 4 && rnd() > 0.5) continue;
      const isRaise = !['Fold', 'Check', 'Call'].includes(x.name), inc = isRaise ? x.to - nd.price : 0;
      // a full raise sets the new minimum; a short all-in does not lower it
      const lastRaise = isRaise ? Math.max(q.lastRaise, inc >= q.lastRaise - 1e-9 ? inc : q.lastRaise) : q.lastRaise;
      const child = { path: [...q.path, x.slot], board: q.board, parent: nd, action: x, lastRaise: x.leadsTo === 'chance' ? 0 : lastRaise, prevPrice: nd.price };
      if (x.leadsTo === 'chance' || q.parent && q.action === 'chance' || q.deep) { child.deep = true; deep.push(child); } else queue.push(child);
    }
  }
  stats.streets = [...stats.streets]; return stats;
}
test('4.4 rules walk: chips, actors, legal actions, minimum raises, transitions, chance, blockers and strategy normalization in six-player flop, five-player flop, four-player turn, three-player river and heads-up trees', { skip, timeout: 900000 }, t => {
  const want = { flop6bets: { limit: 140, live: 6, streets: ['flop', 'turn'] }, flop6: { limit: 60, live: 6, streets: ['flop'] }, flop5: { limit: 40, live: 5, streets: ['flop'] }, turn4: { limit: 110, live: 4, streets: ['turn', 'river'] },
    river3: { limit: 60, live: 3, streets: ['river'] }, river3icm: { limit: 40, live: 3, streets: ['river'] }, huTurn: { limit: 30, live: 2, streets: ['turn', 'river'] }, huRiver: { limit: 60, live: 2, streets: ['river'] } };
  for (const [name, w] of Object.entries(want)) {
    const st = walk(study(t, name), w.limit);
    t.diagnostic(name + ': ' + JSON.stringify(st));
    assert.equal(st.maxLive, w.live, name); for (const s of w.streets) assert.ok(st.streets.includes(s), name + ' reaches the ' + s);
    assert.ok(st.decisions >= Math.min(w.limit, 8) - 4 && st.strategies > 0 && st.actions > st.decisions, name);
  }
  // the multi-size trees exercise raises, minimum raises and all-ins
  const big = walk(study(t, 'flop6bets'), 60), hu = walk(study(t, 'huRiver'), 60);
  assert.ok(big.raises > 20 && big.allIns > 10 && big.minRaiseChecked > 0, JSON.stringify(big)); assert.ok(hu.minRaiseChecked > 0 && hu.raises >= 10 && hu.shortAllInRaises > 0, JSON.stringify(hu));
});
test('4.4 rules walk: eight-player preflop with individual antes (0.1 bb a seat, 0.5/1 blinds, 2.3 bb starting pot) and four-player bubble: blinds, antes, short stacks, all-ins', { skip, timeout: 900000 }, t => {
  const F = study(t, 'final8'), root = F.node({ path: [], limit: 5 }).json.node, R = F.spec.rules;
  assert.equal(F.spec.n, 8); assert.ok(near(root.pot, 2.3), 'initial eight-player pot ' + root.pot);
  assert.deepEqual(R.ownAnte, Array(8).fill(0.1), 'individual antes, not a big-blind ante'); assert.ok(near(sum(R.ownAnte), 0.8));
  assert.deepEqual(R.posted, [0, 0, 0, 0, 0, 0, 0.5, 1], 'small blind 0.5 (seat SB), big blind 1 (seat BB)');
  assert.deepEqual(root.streetPut, [0, 0, 0, 0, 0, 0, 0.5, 1]); assert.equal(root.actor, 0, 'UTG acts first');
  const STACKS8 = [30, 22, 15, 40, 9, 18, 25, 12];   // the study's stacks before antes
  for (let p = 0; p < 8; p++) assert.ok(near(root.behind[p] + root.committed[p] + 0.1, STACKS8[p]), 'seat ' + p + ' paid its own 0.1 bb ante: ' + root.behind[p]);
  assert.ok(near(R.pot0, 0.8), 'antes in the pot before the blinds');
  const st8 = walk(F, 80); t.diagnostic('final8: ' + JSON.stringify(st8)); assert.equal(st8.maxLive, 8); assert.ok(st8.allIns >= 5 && st8.decisions >= 30, JSON.stringify(st8));
  const B = study(t, 'bubble4'), b = B.node({ path: [], limit: 5 }).json.node;
  assert.ok(near(b.pot, 1.9), 'four dealt: 0.4 antes + 1.5 blinds'); assert.deepEqual(B.spec.rules.posted, [0, 0, 0.5, 1]);
  const st4 = walk(B, 40); t.diagnostic('bubble4: ' + JSON.stringify(st4)); assert.equal(st4.maxLive, 4);
  // big-blind-ante option is preserved: the BB posts the whole ante, the pot is the same 2.3 bb
  const bba = E.MultiwayGame({ ...base, preflop: { mode: 'shove' }, board: '', dealt: 8, common: 0, stacks: Array(8).fill(25), ranges: Array(8).fill('AA'), anteType: 'bba', privateSeed: 1 }).nativeSpec().rules;
  assert.ok(bba.ownAnte[7] > 0 && bba.ownAnte.slice(0, 7).every(x => x === 0), 'big-blind ante: only the big blind pays: ' + JSON.stringify(bba.ownAnte));
  const ind = E.MultiwayGame({ ...base, preflop: { mode: 'shove' }, board: '', dealt: 8, common: 0, stacks: Array(8).fill(25), ranges: Array(8).fill('AA'), privateSeed: 1 }).nativeSpec().rules;
  assert.deepEqual(ind.ownAnte, Array(8).fill(0.1), 'the default remains individual antes');
});

// ---- B. value checks ----
const EXQ = { method: 'exact', timeLimitMs: 600000, maxVisits: 2000000000 };
const chipGames = ['flop6', 'flop5', 'turn4', 'river3', 'huTurn', 'huRiver'];
test('4.4 chip conservation and two independent evaluators: seat values sum to the starting pot; best-response evaluator and action-EV evaluator agree on the root actor (six-, five-, four-, three- and two-player chip-EV trees)', { skip, timeout: 900000 }, t => {
  for (const name of chipGames) {
    const S = study(t, name), R = S.spec.rules;
    const g1 = S.gain({ ...EXQ, threads: 1 }), g4 = S.gain({ ...EXQ, threads: 4 }); assert.ok(g1.json && g4.json, name + ': ' + g1.error + g4.error);
    const seats = g1.json.seats; assert.equal(seats.length, S.spec.n); assert.equal(g1.json.utility.model, 'chip');
    assert.ok(Math.abs(sum(seats.map(s => s.policyValue)) - R.pot0) < 1e-9 * Math.max(1, R.pot0), name + ': seat values sum to ' + sum(seats.map(s => s.policyValue)) + ', starting pot ' + R.pot0);
    for (const s of seats) { assert.ok(s.gain >= -1e-9, name + ' seat ' + s.seat + ' gain ' + s.gain); assert.ok(near(s.bestResponseValue - s.policyValue, s.gain, 1e-9)); }
    assert.deepEqual(g4.json.seats.map(s => s.gainBits), seats.map(s => s.gainBits), name + ': gains bit-identical for 1 and 4 threads');
    const actor = S.node({ path: [], limit: 1 }).json.node.actor;
    const e1 = S.ev({ path: [], hands: [0], range: true, ...EXQ, threads: 1 }), e4 = S.ev({ path: [], hands: [0], range: true, ...EXQ, threads: 4 }), eb = S.ev({ path: [], hands: [0], range: true, ...EXQ, threads: 1 }, { EM_EV_NO_TABLES: '1' });
    assert.ok(e1.json && e4.json && eb.json, name + ': ' + e1.error + e4.error + eb.error);
    assert.ok(rel(e1.json.range.mixed, seats[actor].policyValue) < 1e-10, name + ': action-EV evaluator ' + e1.json.range.mixed + ' vs best-response evaluator ' + seats[actor].policyValue);
    assert.deepEqual(e4.json.hands[0].evBits, e1.json.hands[0].evBits, name + ': EV bit-identical for 1 and 4 threads'); assert.deepEqual(e4.json.range.evBits, e1.json.range.evBits);
    for (let a = 0; a < e1.json.hands[0].ev.length; a++) assert.ok(rel(e1.json.hands[0].ev[a], eb.json.hands[0].ev[a]) < 1e-12, name + ' action ' + a + ': tables ' + e1.json.hands[0].ev[a] + ' vs per-board enumeration ' + eb.json.hands[0].ev[a]);
    // the mixed value is the strategy-weighted mean of the action EVs
    const h = e1.json.hands[0]; assert.ok(near(h.mixed, sum(h.ev.map((v, a) => v * h.strategy[a])), 1e-9), name + ': mixed EV');
  }
});
test('4.4 ICM: seat values sum to the prize pool on the bubble (4 players, 3 paid) and at the final table (8 players, 8 paid); evaluators agree; with players at other tables the sum is below the pool', { skip, timeout: 900000 }, t => {
  for (const [name, pool] of [['bubble4', 100], ['final8', 100]]) {
    const S = study(t, name), g = S.gain({ ...EXQ, threads: 4 }); assert.ok(g.json, name + ': ' + g.error);
    assert.equal(g.json.utility.model, 'icm');
    const pv = g.json.seats.map(s => s.policyValue); assert.ok(Math.abs(sum(pv) - pool) < 1e-8, name + ': ICM values sum to ' + sum(pv));
    for (const s of g.json.seats) { assert.ok(s.gain >= -1e-9); assert.ok(s.policyValue > 0 && s.policyValue < pool); }
    const actor = S.node({ path: [], limit: 1 }).json.node.actor, e = S.ev({ path: [], hands: [0], range: true, ...EXQ, threads: 4 }); assert.ok(e.json, e.error);
    assert.ok(rel(e.json.range.mixed, pv[actor]) < 1e-10, name + ': ' + e.json.range.mixed + ' vs ' + pv[actor]);
    if (name === 'bubble4') {   // 4 bb short stack has the lowest equity, the 20 bb stack the highest
      const order = pv.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).map(x => x[1]); assert.equal(order[0], 3); assert.equal(order[3], 2);
    }
  }
  const S = study(t, 'river3icm'), g = S.gain({ ...EXQ, threads: 2 }); assert.ok(g.json, g.error);
  const s3 = sum(g.json.seats.map(s => s.policyValue)); assert.ok(s3 > 0 && s3 < 100, 'three seats of a four-player tournament hold ' + s3 + ' of 100');
  // chip utility on the same tree conserves chips
  const c = S.gain({ ...EXQ, threads: 2, utility: 'chip' });
  if (c.json) assert.ok(Math.abs(sum(c.json.seats.map(s => s.policyValue)) - S.spec.rules.pot0) < 1e-9);
});
test('4.4 sampling agrees with exact enumeration: weighted ranges, chance cards and multiway all-ins (sampled range EV within 5 standard errors of the exact value)', { skip, timeout: 900000 }, t => {
  for (const name of ['flop6', 'flop5', 'turn4', 'huRiver', 'river3icm']) {
    const S = study(t, name);
    const ex = S.ev({ path: [], hands: [], range: true, ...EXQ, threads: 4 }).json, sm = S.ev({ path: [], hands: [], range: true, method: 'sampled', samples: 40000, seed: 7, threads: 4, timeLimitMs: 600000 }).json;
    assert.ok(ex && sm, name); assert.equal(sm.status, 'completed');
    for (let a = 0; a < ex.range.ev.length; a++) {
      const se = sm.range.stdErr[a];
      assert.ok(Math.abs(sm.range.ev[a] - ex.range.ev[a]) <= 5 * se + 1e-9, name + ' action ' + a + ': sampled ' + sm.range.ev[a] + ' +/- ' + se + ' vs exact ' + ex.range.ev[a]);
    }
    // same seed, different thread counts: identical estimate (deterministic block streams)
    const s1 = S.ev({ path: [], hands: [], range: true, method: 'sampled', samples: 4000, seed: 7, threads: 1, timeLimitMs: 600000 }).json, s3 = S.ev({ path: [], hands: [], range: true, method: 'sampled', samples: 4000, seed: 7, threads: 3, timeLimitMs: 600000 }).json;
    assert.deepEqual(s3.range.evBits, s1.range.evBits, name + ': sampled estimate independent of the thread count');
  }
});
