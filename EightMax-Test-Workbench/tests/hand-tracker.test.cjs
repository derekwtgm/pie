'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const EM = require('../src/engine.js'), HS = require('../src/hand-state.js'), LG = require('../src/hand-ledger.js');

/** What an image reading provides: no action history, no per-seat totals, only what is visible. */
function screen(t, seq, heroSeat = t.actor >= 0 ? t.actor : 0, o = {}) {
  const snap = t.snapshot(), l = t.status === 'playing' ? t.legal() : null, fields = { board: 1, pot: 1, stacks: 1, button: 1, actor: 1, street: 1, hand: 1, bets: 1, controls: 1 };
  const ob = { format: 'eightmax-observation', version: 1, table: t.id, seq, source: 'image', capturedAt: 0, layout: { id: 'eightmax-8max-v2', seats: 8 }, hand: t.hand, status: t.status === 'complete' ? 'complete' : 'playing', street: t.street === 'ready' ? 'preflop' : t.street,
    board: snap.board.slice(), button: t.dealer, actor: t.status === 'playing' ? t.actor : -1, pot: snap.pot, confidence: { overall: 1, fields },
    seats: snap.players.map((p, i) => ({ seat: i, stack: p.stack, bet: p.bet, folded: p.folded, cards: i === heroSeat ? p.cards.slice() : null })) };
  if (l && t.actor === heroSeat && o.controls !== false) { ob.controls = { fold: l.toCall > 0, check: l.canCheck, call: l.toCall > 0, raise: l.canRaise }; if (l.toCall > 0) ob.callAmount = l.callAmount; if (l.canRaise) ob.minRaiseTo = Math.min(l.minRaiseTo, l.maxRaiseTo); }
  return ob;
}
const engine = (o = {}) => new HS.HandStateEngine(1, { track: true, expectedLayout: 'eightmax-8max-v2', ...o });
const act = (t) => { const a = EM.policy(t); t.execute(t.request(a.type, a.amount, 0), 0); return a; };

test('frame-by-frame: the action history is DERIVED from screens and equals what really happened (60 hands)', () => {
  const t = new EM.Table(1, 321), e = engine(); let seq = 0, derived = 0;
  for (let h = 0; h < 60; h++) {
    t.startHand(); const truth = [];
    for (let g = 0; g < 120; g++) {
      const r = e.ingest(screen(t, seq++)); assert.ok(r.accepted, JSON.stringify(r.issues)); assert.equal(r.state.tracked, true);
      if (t.status !== 'playing') break;
      const before = t.actor, a = act(t); truth.push([before, a.type]);
    }
    const r = e.ingest(screen(t, seq++)); assert.ok(r.accepted, JSON.stringify(r.issues)); assert.equal(r.state.status, 'complete'); assert.equal(r.state.settlement.ok, true);
    assert.deepEqual(r.state.actions.map((a) => a.seat), truth.map((x) => x[0])); derived += truth.length;
    assert.deepEqual(r.state.actions.map((a) => (a.type === 'allin' || a.type === 'bet' ? 'raise' : a.type)), truth.map((x) => x[1] === 'raise' ? 'raise' : x[1]));
    assert.equal(r.state.seats.reduce((a, p) => a + p.stack, 0), 20000);
  }
  assert.ok(derived > 800);
});
test('derived contributions, side pots, minimum raise and reopening match the rules (state is decorated)', () => {
  const t = new EM.Table(1, 11), e = engine(); let seq = 0; t.startHand();
  const r0 = e.ingest(screen(t, seq++)); assert.equal(r0.state.pot, 230); assert.deepEqual(r0.state.seats.map((s) => s.total), [10, 60, 110, 10, 10, 10, 10, 10]); assert.equal(r0.state.legal.exact, true); assert.equal(r0.state.legal.minRaiseTo, 200);
  assert.equal(r0.state.stakes.bb, 100); assert.deepEqual(r0.state.startStacks, Array(8).fill(2500)); assert.deepEqual(r0.state.sidePots, [{ amount: 230, eligible: [0, 1, 2, 3, 4, 5, 6, 7] }].map((p) => ({ amount: 230, eligible: p.eligible })));
});
test('gaps: several actions between two readings are recovered when each seat acted once', () => {
  const t = new EM.Table(1, 5), e = engine(); let seq = 0; t.startHand(); assert.ok(e.ingest(screen(t, seq++)).accepted);
  for (let i = 0; i < 4; i++) { t.execute(t.request(t.legal().toCall > 0 ? 'call' : 'check', 0, 0), 0); } // four players call; no reading in between
  const r = e.ingest(screen(t, seq++)); assert.ok(r.accepted, JSON.stringify(r.issues)); assert.deepEqual(r.state.actions.map((a) => a.seat), [3, 4, 5, 6]); assert.ok(r.state.actions.every((a) => a.type === 'call'));
});
test('a gap across a street change is recovered when the closing actions are forced', () => {
  const t = new EM.Table(1, 5), e = engine(); let seq = 0; t.startHand(); assert.ok(e.ingest(screen(t, seq++)).accepted);
  for (let i = 0; i < 8; i++) t.execute(t.request(t.legal().toCall > 0 ? 'call' : 'check', 0, 0), 0); // limp round + BB check -> flop
  assert.equal(t.street, 'flop'); const r = e.ingest(screen(t, seq++)); assert.ok(r.accepted, JSON.stringify(r.issues)); assert.equal(r.state.street, 'flop'); assert.equal(r.state.actions.length, 8); assert.equal(r.state.actions[7].type, 'check');
});
test('ambiguous gaps are rejected: a seat that acted twice cannot be explained', () => {
  const t = new EM.Table(1, 5), e = engine(); let seq = 0; t.startHand(); assert.ok(e.ingest(screen(t, seq++)).accepted);
  t.execute(t.request('raise', 300, 0), 0); for (let i = 0; i < 5; i++) t.execute(t.request('fold', 0, 0), 0); // 3 raises; 4,5,6,7,0 fold
  t.execute(t.request('raise', 900, 0), 0); t.execute(t.request('fold', 0, 0), 0); t.execute(t.request('call', 0, 0), 0); // seat 1 re-raises, seat 2 folds, seat 3 calls: seat 3 acted twice
  assert.equal(t.street, 'flop'); const r = e.ingest(screen(t, seq++)); assert.equal(r.accepted, false); assert.match(r.issues[0].code, /ambiguous-gap|unexplained-change/); assert.equal(r.paused, true);
  // the same history observed step by step is perfectly explainable
  const t2 = new EM.Table(1, 5), e2 = engine(); seq = 0; t2.startHand(); assert.ok(e2.ingest(screen(t2, seq++)).accepted);
  for (const [type, amount] of [['raise', 300], ['fold', 0], ['fold', 0], ['fold', 0], ['fold', 0], ['fold', 0], ['raise', 900], ['fold', 0], ['call', 0]]) { t2.execute(t2.request(type, amount, 0), 0); const q = e2.ingest(screen(t2, seq++)); assert.ok(q.accepted, JSON.stringify(q.issues)); }
});
test('a hand first seen mid-way is not guessed at: rejected until the next hand opens, then recovery', () => {
  const t = new EM.Table(1, 9), e = engine(); let seq = 0; t.startHand(); t.execute(t.request('call', 0, 0), 0); t.execute(t.request('call', 0, 0), 0);
  let r = e.ingest(screen(t, seq++)); assert.equal(r.accepted, false); assert.match(r.issues[0].code, /missed-hand-start|hand-start-mismatch/); assert.equal(r.paused, true);
  r = e.ingest(screen(t, seq++)); assert.equal(r.issues[0].code, 'untracked-hand', 'the same hand stays untracked');
  while (t.status === 'playing') { const a = EM.policy(t); t.execute(t.request(a.type, a.amount, 0), 0); } assert.equal(e.ingest(screen(t, seq++)).accepted, false, 'the end of an untracked hand is refused too');
  t.startHand(); r = e.ingest(screen(t, seq++)); assert.ok(r.accepted); assert.equal(r.paused, true, 'still paused: one good frame is not enough'); t.execute(t.request('call', 0, 0), 0); r = e.ingest(screen(t, seq++)); assert.ok(r.accepted); assert.equal(r.paused, false, 'two consistent readings resume the table');
});
test('readings that contradict the rules are rejected: pot, controls, board, folded seat coming back, wrong actor', () => {
  const mkAt = () => { const t = new EM.Table(1, 4), e = engine(); t.startHand(); assert.ok(e.ingest(screen(t, 0)).accepted); return { t, e }; };
  let { t, e } = mkAt(); t.execute(t.request('call', 0, 0), 0); let o = screen(t, 1); o.pot += 10; let r = e.ingest(o); assert.equal(r.accepted, false); assert.match(r.issues[0].code, /inconsistent-pot|unexplained/);
  ({ t, e } = mkAt()); o = screen(t, 1); o.controls = { fold: true, check: true, call: true, raise: true }; o.callAmount = 100; o.minRaiseTo = 200; r = e.ingest(o); assert.equal(r.accepted, false); assert.equal(r.issues[0].code, 'controls-disagree'); assert.match(r.issues[0].detail, /check/);
  ({ t, e } = mkAt()); o = screen(t, 1); o.controls = { fold: true, check: false, call: true, raise: true }; o.callAmount = 90; o.minRaiseTo = 200; r = e.ingest(o); assert.equal(r.issues[0].code, 'controls-disagree'); assert.match(r.issues[0].detail, /call amount/);
  ({ t, e } = mkAt()); o = screen(t, 1); o.controls = { fold: true, check: false, call: true, raise: true }; o.callAmount = 100; o.minRaiseTo = 150; r = e.ingest(o); assert.match(r.issues[0].detail, /minimum raise/);
  ({ t, e } = mkAt()); o = screen(t, 1); o.actor = 5; assert.equal(e.ingest(o).accepted, false);
  ({ t, e } = mkAt()); t.execute(t.request('fold', 0, 0), 0); r = e.ingest(screen(t, 1)); assert.ok(r.accepted); const o2 = screen(t, 2); o2.seats[3].folded = false; assert.equal(e.ingest(o2).accepted, false, 'a folded player cannot un-fold');
  ({ t, e } = mkAt()); o = screen(t, 1); o.hand = undefined; r = e.ingest(o); assert.equal(r.issues[0].code, 'missing-hand-id');
  ({ t, e } = mkAt()); o = screen(t, 1); o.seats[0].stack = 2400; assert.equal(e.ingest(o).accepted, false, 'a stack that dropped with no action is not an outcome of any legal action');
});
test('all-in markers must agree with the stacks', () => {
  const t = new EM.Table(1, 4), e = engine(); t.startHand(); const o = screen(t, 0); o.seats[4].allInMarker = true; const r = e.ingest(o); assert.equal(r.accepted, false); assert.match(r.issues[0].detail, /all-in marker/);
});
test('all-in runouts and short stacks: side pots appear in the reconstructed state and settlement is checked', () => {
  const t = new EM.Table(1, 77), e = engine(); let seq = 0; t.setNextStacks([400, 900, 2500, 2500, 2500, 2500, 2500, 2500]); t.startHand(); let sawSide = false;
  for (let g = 0; g < 100; g++) { const r = e.ingest(screen(t, seq++)); assert.ok(r.accepted, JSON.stringify(r.issues)); if (r.state.sidePots && r.state.sidePots.length > 1) sawSide = true; if (t.status !== 'playing') { assert.equal(r.state.settlement.ok, true); break; }
    const l = t.legal(); if (l.canRaise && t.actor < 3) t.execute(t.request('raise', l.maxRaiseTo, 0), 0); else t.execute(t.request(l.toCall > 0 ? 'call' : 'check', 0, 0), 0); }
  assert.equal(t.status, 'complete'); assert.ok(sawSide, 'short stacks all-in for different amounts create side pots');
});
test('impossible settlements are rejected: a folded player cannot win, chips cannot appear', () => {
  const t = new EM.Table(1, 3), e = engine(); let seq = 0; t.startHand(); assert.ok(e.ingest(screen(t, seq++)).accepted);
  for (let i = 0; i < 7; i++) t.execute(t.request('fold', 0, 0), 0); assert.equal(t.status, 'complete'); const good = screen(t, seq);
  const bad = JSON.parse(JSON.stringify(good)); bad.seq = seq + 1; const w = good.seats.findIndex((s, i) => !s.folded); const loser = good.seats.findIndex((s, i) => s.folded && i !== w);
  bad.seats[w].stack -= 100; bad.seats[loser].stack += 100; let r = e.ingest(bad); assert.equal(r.accepted, false); assert.equal(r.issues[0].code, 'bad-settlement');
  const bad2 = JSON.parse(JSON.stringify(good)); bad2.seq = seq + 2; bad2.seats[w].stack += 50; r = e.ingest(bad2); assert.equal(r.issues[0].code, 'bad-settlement'); assert.match(r.issues[0].detail, /conserved|Sole survivor/);
  r = e.ingest({ ...good, seq: seq + 3 }); assert.ok(r.accepted, JSON.stringify(r.issues));
});
test('configurable stakes: 2/4 blinds with 0.25 ante and mixed stacks reconstruct and are checked against the ledger', () => {
  const o = { sb: 100, bb: 200, ante: 25 }, stacks = [6000, 5000, 9000, 7000, 8000, 4000, 6500, 10000], led = new LG.HandLedger({ button: 3, stacks, ...o }), e = engine(o);
  const view = (l, seq, status = 'playing') => ({ format: 'eightmax-observation', version: 1, table: 1, seq, source: 'image', layout: { id: 'eightmax-8max-v2', seats: 8 }, hand: 7, status, street: l.streetName, board: l.board.slice(), button: 3, actor: l.actor, pot: l.pot, confidence: { overall: 1, fields: { board: 1, pot: 1, stacks: 1, button: 1, actor: 1, street: 1 } }, seats: l.p.map((q, i) => ({ seat: i, stack: q.stack, bet: q.bet, folded: q.folded, cards: null })) });
  let r = e.ingest(view(led, 0)); assert.ok(r.accepted, JSON.stringify(r.issues)); assert.equal(r.state.pot, 8 * 25 + 300); assert.equal(r.state.legal.minRaiseTo, 400);
  led.apply({ seat: led.actor, type: 'raise', amount: 500 }); r = e.ingest(view(led, 1)); assert.ok(r.accepted, JSON.stringify(r.issues)); assert.equal(r.state.actions[0].type, 'raise'); assert.equal(r.state.legal.minRaiseTo, 800);
  const wrong = engine(); const bad = view(new LG.HandLedger({ button: 3, stacks, ...o }), 0); assert.equal(wrong.ingest(bad).accepted, false, 'the same screen is refused under the default 0.5/1/0.1 structure');
});
test('checkpoint and restart: the table stays paused until fresh readings agree, then continues the same hand', () => {
  const t = new EM.Table(1, 21), e = engine(); let seq = 0; t.startHand(); for (let i = 0; i < 5; i++) { assert.ok(e.ingest(screen(t, seq++)).accepted); act(t); }
  const cp = JSON.parse(JSON.stringify(e.exportCheckpoint())), e2 = engine(); e2.restoreCheckpoint(cp); assert.equal(e2.paused, true);
  let r = e2.ingest(screen(t, 0)); assert.ok(r.accepted); assert.equal(r.paused, true); r = e2.ingest(screen(t, 1)); assert.equal(r.paused, false); assert.equal(r.state.actions.length >= 5, true);
  const tampered = JSON.parse(JSON.stringify(cp)); tampered.tr.led.p[0].stack += 5; assert.throws(() => engine().restoreCheckpoint(tampered), /conserve/); assert.throws(() => new HS.HandStateEngine(2, { track: true }).restoreCheckpoint(cp), /not for this table/);
});
