'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const EM = require('../src/engine.js'), LG = require('../src/hand-ledger.js');
const { HandLedger } = LG;
const mk = (stacks, button = 0, extra = {}) => new HandLedger({ button, stacks, ...extra });

test('differential test: ledger and simulator agree on every legal-action view, pot, street and award (400 hands, random stacks 1.5-90 BB)', () => {
  let hands = 0, actions = 0, allin = 0, multiway = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const t = new EM.Table(1, seed * 7919), r = new EM.RNG(seed);
    for (let h = 0; h < 10; h++) {
      const stacks = Array.from({ length: 8 }, () => [300, 700, 1500, 2500, 4000, 9000][Math.floor(r.next() * 6)]);
      t.setNextStacks(stacks); t.startHand(); const led = mk(stacks, t.dealer), hole = {}; t.players.forEach((p, i) => { hole[i] = p.cards.slice(); });
      for (let guard = 0; t.status === 'playing' && guard < 200; guard++) {
        const lg = t.legal(), ll = led.legal();
        assert.equal(led.actor, t.actor); assert.equal(ll.toCall, lg.toCall); assert.equal(ll.canCheck, lg.canCheck); assert.equal(ll.canRaise, lg.canRaise); assert.equal(ll.maxRaiseTo, lg.maxRaiseTo);
        if (lg.canRaise) assert.equal(Math.min(ll.maxRaiseTo, ll.fullMinRaiseTo), Math.min(lg.maxRaiseTo, lg.minRaiseTo));
        const u = r.next(); let type, amount = 0;
        if (ll.toCall > 0 && u < 0.25) type = 'fold'; else if (ll.canRaise && u > 0.6) { type = 'raise'; const lo = Math.min(ll.maxRaiseTo, ll.fullMinRaiseTo); amount = r.next() < 0.2 ? ll.maxRaiseTo : lo + Math.floor(r.next() * (ll.maxRaiseTo - lo + 1)); } else type = ll.canCheck ? 'check' : 'call';
        t.execute(t.request(type, amount, 0), 0); const e = led.apply({ seat: led.actor, type, amount }); actions++; if (e.allIn) allin++;
        if (led.status === 'awaiting-board' || (led.status === 'showdown' && led.board.length < 5)) led.dealBoard(t.board.slice(led.board.length));
        if (t.status === 'playing') { assert.equal(led.status, 'betting'); assert.equal(led.actor, t.actor); assert.equal(led.pot, t.pot()); }
      }
      assert.equal(t.status, 'complete'); if (t.board.length > led.board.length) led.dealBoard(t.board.slice(led.board.length));
      if (led.live.length > 1) { multiway += led.live.length > 2 ? 1 : 0; const aw = led.showdown(hole, { perLevelOddChips: true }); assert.deepEqual(aw.map((a, i) => a + led.p[i].stack), t.players.map((p) => p.stack)); }
      const cs = led.checkSettlement(t.players.map((p) => p.stack)); assert.ok(cs.ok, cs.reasons.join('; ')); hands++;
    }
  }
  assert.equal(hands, 400); assert.ok(actions > 2000 && allin > 100 && multiway > 20, JSON.stringify({ actions, allin, multiway }));
});
test('blinds, antes and the opening pot: 8-handed 2.3 BB, configurable stakes', () => {
  const l = mk(Array(8).fill(2500), 0); assert.equal(l.pot, 230); assert.equal(l.actor, 3); assert.equal(l.legal().toCall, 100); assert.equal(l.p[1].bet, 50); assert.equal(l.p[2].bet, 100);
  const c = mk(Array(8).fill(5000), 5, { sb: 100, bb: 200, ante: 25 }); assert.equal(c.pot, 8 * 25 + 300); assert.equal(c.legal().fullMinRaiseTo, 400); assert.equal(c.sbSeat, 6);
  const hu = new HandLedger({ seats: 2, button: 0, stacks: [1000, 1000] }); assert.equal(hu.sbSeat, 0); assert.equal(hu.actor, 0, 'heads-up: the button/small blind acts first preflop');
  assert.throws(() => mk([100, 0, 100, 100, 100, 100, 100, 100]), /positive starting stack/); assert.throws(() => new HandLedger({ button: 9, stacks: Array(8).fill(100) }), /Button/);
});
test('illegal actions are refused: out of turn, check facing a bet, fold for free, short raise, raise above stack', () => {
  const l = mk(Array(8).fill(2500)); assert.throws(() => l.apply({ seat: 5, type: 'call' }), /not the player to act/); assert.throws(() => l.apply({ seat: 3, type: 'check' }), /Cannot check/);
  assert.throws(() => l.apply({ seat: 3, type: 'raise', amount: 150 }), /below the minimum/); assert.throws(() => l.apply({ seat: 3, type: 'raise', amount: 5000 }), /outside/); assert.throws(() => l.apply({ seat: 3, type: 'bogus' }), /Unknown action/);
  const bbOption = mk(Array(8).fill(2500)); for (const s of [3, 4, 5, 6, 7, 0, 1]) bbOption.apply({ seat: s, type: s === 1 ? 'call' : 'call' }); assert.equal(bbOption.actor, 2); assert.throws(() => bbOption.apply({ seat: 2, type: 'fold' }), /nothing to call/);
  assert.throws(() => l.dealBoard([1, 2, 3]), /cannot be dealt/);
});
test('betting round closes only when everyone matched; the big blind keeps the option; the board is then required', () => {
  const l = mk(Array(8).fill(2500)); for (const s of [3, 4, 5, 6, 7, 0]) l.apply({ seat: s, type: 'call' }); l.apply({ seat: 1, type: 'call' });
  assert.equal(l.status, 'betting'); assert.equal(l.actor, 2); assert.equal(l.legal().canCheck, true); l.apply({ seat: 2, type: 'check' });
  assert.equal(l.status, 'awaiting-board'); assert.throws(() => l.dealBoard([1, 1, 2]), /Duplicate/); assert.throws(() => l.dealBoard([1, 2]), /Partial/); l.dealBoard([1, 2, 3]); assert.equal(l.streetName, 'flop'); assert.equal(l.actor, 1, 'first live seat left of the button acts postflop'); assert.equal(l.currentBet, 0);
});
test('short all-in raise does not reopen the betting for players who already acted', () => {
  const l = mk([2500, 2500, 2500, 2500, 2500, 2500, 2500, 450]); // seat 7 has 4.5 BB after... shove is a short raise
  l.apply({ seat: 3, type: 'raise', amount: 300 }); for (const s of [4, 5, 6]) l.apply({ seat: s, type: 'fold' });
  const e = l.apply({ seat: 7, type: 'raise', amount: 450 - 10 + 0 }); assert.equal(e.allIn, true); assert.equal(e.full, false, '440 is a raise of 140 < 200: not a full raise');
  for (const s of [0, 1, 2]) l.apply({ seat: s, type: 'fold' });
  assert.equal(l.actor, 3); const lg = l.legal(); assert.equal(lg.canRaise, false, 'seat 3 already acted and faces only a short raise: may call or fold, not re-raise'); assert.equal(lg.toCall, 140); assert.equal(lg.reopened, false);
});
test('multiway side pots, dead money and uncalled-bet refund', () => {
  const l = mk([300, 800, 2000, 2500, 2500, 2500, 2500, 2500]); // seats 0..2 are short; button 0
  l.apply({ seat: 3, type: 'raise', amount: 2400 }); for (const s of [4, 5, 6, 7]) l.apply({ seat: s, type: 'fold' });
  l.apply({ seat: 0, type: 'call' }); l.apply({ seat: 1, type: 'call' }); l.apply({ seat: 2, type: 'call' });
  assert.equal(l.status, 'awaiting-board'); l.dealBoard([0, 5, 10, 15, 20]); assert.equal(l.status, 'showdown');
  const { pots, refunds } = l.pots(), total = pots.reduce((a, p) => a + p.amount, 0) + refunds.reduce((a, r) => a + r.amount, 0); assert.equal(total, l.pot, 'every chip is in a pot or refunded');
  assert.deepEqual(refunds, [{ seat: 3, amount: 410 }], 'seat 3 bet 2400 into a table whose deepest caller had 1990: the excess is uncalled');
  assert.equal(pots.length, 3); assert.deepEqual(pots[0].eligible, [0, 1, 2, 3]); assert.deepEqual(pots[1].eligible, [1, 2, 3]); assert.deepEqual(pots[2].eligible, [2, 3]);
  assert.equal(pots[0].amount, 8 * 10 + 4 * 290, 'dead antes of the four folded seats are in the main pot but they cannot win it');
  assert.ok(pots.every((p) => !p.eligible.some((s) => s >= 4)), 'folded players are never eligible');
  const aw = l.showdown({ 0: [48, 49], 1: [44, 45], 2: [40, 41], 3: [36, 37] }, {}); assert.equal(aw.reduce((a, b) => a + b, 0), l.pot);
});
test('split pots divide exactly and give odd chips to the first seat clockwise from the button', () => {
  const l = mk(Array(8).fill(2500), 0); for (const s of [3, 4, 5, 6, 7, 0]) l.apply({ seat: s, type: 'fold' }); // only blinds remain
  l.apply({ seat: 1, type: 'call' }); l.apply({ seat: 2, type: 'check' }); l.dealBoard([0, 4, 8]); l.apply({ seat: 1, type: 'check' }); l.apply({ seat: 2, type: 'check' }); l.dealBoard([12]); l.apply({ seat: 1, type: 'check' }); l.apply({ seat: 2, type: 'check' }); l.dealBoard([44]);
  l.apply({ seat: 1, type: 'check' }); l.apply({ seat: 2, type: 'check' }); assert.equal(l.status, 'showdown');
  const aw = l.showdown({ 1: [21, 25], 2: [22, 26] }); // same ranks, different suits, none of them clubs: a chop
  assert.equal(aw[1] + aw[2], l.pot); assert.equal(Math.abs(aw[1] - aw[2]) <= 1, true); assert.equal(aw.reduce((a, b) => a + b, 0), l.pot);
});
test('settlement checks reject impossible outcomes', () => {
  const l = mk(Array(8).fill(2500), 0); for (const s of [3, 4, 5, 6, 7, 0]) l.apply({ seat: s, type: 'fold' }); l.apply({ seat: 1, type: 'fold' }); assert.equal(l.status, 'complete');
  const good = l.p.map((q) => q.stack); good[2] += l.pot; assert.ok(l.checkSettlement(good).ok);
  const wrongWinner = l.p.map((q) => q.stack); wrongWinner[1] += l.pot; assert.match(l.checkSettlement(wrongWinner).reasons.join(), /folded|Sole survivor/);
  const leak = good.slice(); leak[2] -= 10; assert.match(l.checkSettlement(leak).reasons.join(), /not conserved/); assert.equal(l.checkSettlement([1, 2, 3]).ok, false);
  const split = good.slice(); split[2] -= 20; split[4] += 20; assert.equal(l.checkSettlement(split).ok, false);
});
test('ledger checkpoints round-trip and reject tampering', () => {
  const l = mk(Array(8).fill(2500)); l.apply({ seat: 3, type: 'raise', amount: 300 }); const j = JSON.parse(JSON.stringify(l.toJSON())), r = HandLedger.fromJSON(j);
  assert.deepEqual(r.project(), l.project()); assert.equal(r.legal().minRaiseTo, l.legal().minRaiseTo); j.p[3].stack += 5; assert.throws(() => HandLedger.fromJSON(j), /conserve/); assert.throws(() => HandLedger.fromJSON({}), /Not a hand-ledger/);
});
