'use strict';
// Shared helper: what an image reading provides (no history, no totals), built from an oracle table.
const HS = require('../src/hand-state.js');
function screen(t, seq, heroSeat = t.actor >= 0 ? t.actor : 0, o = {}) {
  const snap = t.snapshot(), l = t.status === 'playing' ? t.legal() : null, fields = { board: 1, pot: 1, stacks: 1, button: 1, actor: 1, street: 1, hand: 1, bets: 1, controls: 1 };
  const ob = { format: 'eightmax-observation', version: 1, table: t.id, seq, source: 'image', capturedAt: 0, layout: { id: 'eightmax-8max-v2', seats: 8 }, hand: t.hand, status: t.status === 'complete' ? 'complete' : 'playing', street: t.street === 'ready' ? 'preflop' : t.street,
    board: snap.board.slice(), button: t.dealer, actor: t.status === 'playing' ? t.actor : -1, pot: snap.pot, confidence: { overall: 1, fields },
    seats: snap.players.map((p, i) => ({ seat: i, stack: p.stack, bet: p.bet, folded: p.folded, cards: i === heroSeat ? p.cards.slice() : null })) };
  if (l && t.actor === heroSeat && o.controls !== false) { ob.controls = { fold: l.toCall > 0, check: l.canCheck, call: l.toCall > 0, raise: l.canRaise }; if (l.toCall > 0) ob.callAmount = l.callAmount; if (l.canRaise) ob.minRaiseTo = Math.min(l.minRaiseTo, l.maxRaiseTo); }
  return ob;
}
const engine = (o = {}) => new HS.HandStateEngine(1, { track: true, expectedLayout: 'eightmax-8max-v2', ...o });
module.exports = { screen, engine };
