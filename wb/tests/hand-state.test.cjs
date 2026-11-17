'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const EM = require('../src/engine.js'), H = require('../src/hand-state.js');
const clone = (x) => JSON.parse(JSON.stringify(x));

function freshTable(seed = 11) { const t = new EM.Table(1, seed); t.startHand(); return t; }

test('default tournament structure: eight-handed opening pot is 2.3 BB', () => {
  assert.equal(H.START_POT, 230);
  const t = freshTable(), e = new H.HandStateEngine(1);
  const r = e.ingest(H.observeSimulator(t, 1, { actions: [] }));
  assert.equal(r.accepted, true, JSON.stringify(r.issues));
  assert.equal(r.state.pot, 230);
  assert.equal(r.state.handStart, true);
  assert.equal(r.state.legal.exact, true);
});

test('every observation of 300 simulated hands reconstructs exactly and matches the simulator', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const t = new EM.Table(1, seed * 977), e = new H.HandStateEngine(1);
    let seq = 0, hands = 0;
    while (hands < 50) {
      if (t.status === 'ready' || t.status === 'complete') { if (t.status === 'complete') hands++; t.startHand(); }
      else t.execute(t.request(...(() => { const a = EM.policy(t); return [a.type, a.amount, 0]; })()), 0);
      const r = e.ingest(H.observeSimulator(t, seq++, { actions: undefined }));
      assert.equal(r.accepted, true, JSON.stringify(r.issues));
      assert.equal(r.state.pot, t.pot() + (t.status === 'complete' ? 0 : 0) || r.state.pot);
      assert.equal(r.state.street, t.street);
      assert.deepEqual(r.state.board, t.board);
      if (t.status === 'playing') {
        assert.equal(r.state.actor, t.actor);
        const l = t.legal();
        assert.equal(r.state.legal.toCall, l.toCall);
        assert.equal(r.state.legal.minRaiseTo, l.minRaiseTo);
        assert.equal(r.state.legal.canRaise, l.canRaise);
      }
    }
    assert.equal(e.rejected, 0);
  }
});

function accepted() { const t = freshTable(5), e = new H.HandStateEngine(1); const o = H.observeSimulator(t, 1, { actions: [] }); assert.ok(e.ingest(o).accepted); return { t, e, o }; }
function expectReject(mutator, code) {
  const { t, e } = accepted(); const o = H.observeSimulator(t, 2, { actions: [] }); mutator(o);
  const r = e.ingest(o);
  assert.equal(r.accepted, false, 'should reject ' + code);
  assert.equal(r.issues[0].code, code, JSON.stringify(r.issues));
  assert.equal(e.paused, true); assert.match(e.pauseReason, new RegExp(code));
  return e;
}

test('explicit rejection of unreadable, missing, contradictory and invalid observations', () => {
  expectReject((o) => { o.confidence.overall = 0.5; }, 'low-confidence');
  expectReject((o) => { o.confidence.fields.pot = 0.2; }, 'low-confidence');
  expectReject((o) => { delete o.confidence.fields.board; }, 'missing-field');
  expectReject((o) => { o.layout.id = 'some-other-room'; }, 'unrecognized-layout');
  expectReject((o) => { o.pot += 100; }, 'inconsistent-pot');
  expectReject((o) => { o.seats[3].stack += 1; }, 'inconsistent-stacks');
  expectReject((o) => { o.board = [1, 2, 3]; }, 'contradiction');
  expectReject((o) => { o.seats[0].cards = [o.seats[1].cards[0], 50]; }, 'invalid-card');
  expectReject((o) => { o.seats.pop(); }, 'ambiguous-seats');
  expectReject((o) => { o.button = 9; }, 'ambiguous-seats');
  expectReject((o) => { o.actor = -1; }, 'ambiguous-seats');
  expectReject((o) => { o.seats[o.actor].folded = true; }, 'contradiction');
  expectReject((o) => { o.table = 2; }, 'wrong-table');
  expectReject((o) => { o.seq = 1; }, 'stale-observation');
  expectReject((o) => { o.actions = [{ seat: 0, type: 'dance' }]; }, 'incomplete-history');
});

test('opening pot that is not 2.3 BB is rejected rather than repaired', () => {
  const t = freshTable(8), e = new H.HandStateEngine(1);
  const o = H.observeSimulator(t, 1, { actions: [] }); o.pot = 220; o.seats[0].total -= 10; o.seats[0].stack += 10;
  const r = e.ingest(o); assert.equal(r.accepted, false); assert.equal(r.issues[0].code, 'inconsistent-start-pot');
});

test('a hand that moves backwards or rewrites history is contradictory; the table stays paused until consistent frames return', () => {
  const t = freshTable(21), e = new H.HandStateEngine(1, { autoResumeAfter: 2 });
  let seq = 1;
  assert.ok(e.ingest(H.observeSimulator(t, seq++, { actions: [] })).accepted);
  while (t.street === 'preflop') t.execute(t.request('call', 0, 0) && (t.legal().canCheck ? t.request('check', 0, 0) : t.request('call', 0, 0)), 0);
  const good = H.observeSimulator(t, seq++, { actions: [] });
  assert.ok(e.ingest(good).accepted);
  const back = clone(good); back.seq = seq++; back.street = 'preflop'; back.board = [];
  assert.equal(e.ingest(back).accepted, false);
  assert.equal(e.paused, true);
  const swap = H.observeSimulator(t, seq++, { actions: [] }); swap.board[0] = (swap.board[0] + 4) % 52;
  assert.equal(e.ingest(swap).accepted, false);
  assert.equal(e.ingest(H.observeSimulator(t, seq++, { actions: [] })).paused, true, 'one good frame is not enough');
  const r = e.ingest(H.observeSimulator(t, seq++, { actions: [] }));
  assert.equal(r.paused, false, 'two consistent frames resume');
});

test('missing hole cards stay missing and are never invented', () => {
  const t = freshTable(3), e = new H.HandStateEngine(1);
  const r = e.ingest(H.observeSimulator(t, 1, { actions: [], revealCards: false }));
  assert.ok(r.accepted);
  assert.ok(r.state.seats.every((p) => p.cards === null));
});

test('revision changes only when the table content changes (basis of stale-decision rejection)', () => {
  const t = freshTable(9), e = new H.HandStateEngine(1);
  const a = e.ingest(H.observeSimulator(t, 1)), b = e.ingest(H.observeSimulator(t, 2));
  assert.equal(a.revision, b.revision); assert.equal(b.changed, false);
  t.execute(t.request('call', 0, 0), 0);
  const c = e.ingest(H.observeSimulator(t, 3));
  assert.ok(c.revision > b.revision);
  assert.notEqual(c.state.key, a.state.key);
});

test('card codec round-trips', () => {
  for (let c = 0; c < 52; c++) assert.equal(H.cardFromString(H.cardToString(c)), c);
  assert.equal(H.cardFromString('Xx'), null);
});

test('shipped example replay: exactly the deliberately corrupted frame is rejected and pauses the table', () => {
  const O = require('../src/vision-ocr.js'), d = require('../examples/multitable/observation-replay-demo.json');
  const r = O.replayObservations(d.frames, { autoResumeAfter: 2 });
  assert.equal(r.frames, 40); assert.equal(r.rejected, 1); assert.equal(r.issues[0].seq, 17); assert.equal(r.issues[0].issues[0].code, 'inconsistent-pot');
  assert.ok(r.pausedFrames.includes(17));
});

test('example QA authorization template is intentionally invalid', () => {
  const X = require('../src/test-executor.js'), a = require('../examples/multitable/qa-authorization-TEMPLATE.json');
  assert.equal(X.validateAuthorization(a, Date.now()).valid, false);
});
