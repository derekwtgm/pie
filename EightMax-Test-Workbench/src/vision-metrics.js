/* EightMax Test Workbench 0.24: recognition accuracy bookkeeping.
 *
 * Every figure is kept per DOMAIN so that synthetic-render accuracy can never be mistaken for real-client accuracy:
 *   'synthetic'       - the built-in pixel renderer (sim-display.js)
 *   'browser-render'  - the controlled client drawn by a real browser engine (real font rasterisation, still our own client)
 *   'real-client'     - genuine, authorised screenshots of an external client. NONE exist in this release: its count stays 0
 *                       and report() says "not measured" rather than extrapolating from the other domains.
 * Categories: card, stack, bet, pot, seat (button / actor / folded / hand id), action (controls, call amount, minimum raise).
 * A reading is ACCEPTED when the observer produced an observation and the hand-state engine accepted it. A FALSE ACCEPTANCE is an
 * accepted reading that differs from the truth in any field the decision depends on.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WorkbenchVisionMetrics = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DOMAINS = ['synthetic', 'browser-render', 'real-client'];
  const CATS = ['card', 'stack', 'bet', 'pot', 'seat', 'action'];
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  /** Ground truth for a frame, from the oracle table (tests only: the decision loop never sees it). */
  function truthFromTable(t, heroSeat) {
    const snap = t.snapshot(), l = t.status === 'playing' && t.actor === heroSeat ? t.legal() : null;
    return { board: snap.board.slice(), hero: snap.players[heroSeat].cards.slice(), stacks: snap.players.map((p) => p.stack), bets: snap.players.map((p) => p.bet), pot: snap.pot, hand: snap.hand, button: t.dealer, actor: t.status === 'playing' ? t.actor : -1, folded: snap.players.map((p) => p.folded), complete: t.status === 'complete', heroSeat,
      controls: l ? { fold: l.toCall > 0, check: l.canCheck, call: l.toCall > 0, raise: l.canRaise } : null, callAmount: l && l.toCall > 0 ? l.callAmount : null, minRaise: l && l.canRaise ? Math.min(l.minRaiseTo, l.maxRaiseTo) : null };
  }

  class MetricsCollector {
    constructor() { this.d = {}; for (const k of DOMAINS) this.d[k] = this._blank(); }
    _blank() { const c = {}; for (const k of CATS) c[k] = { fields: 0, correct: 0, wrong: 0, unread: 0 }; return { frames: 0, readable: 0, accepted: 0, acceptedCorrect: 0, falseAccepted: 0, rejected: 0, rejectReasons: {}, cat: c, confidenceCorrect: [], confidenceWrong: [] }; }
    _score(c, ok, read) { c.fields++; if (!read) c.unread++; else if (ok) c.correct++; else c.wrong++; }
    /**
     * domain, truth (truthFromTable), result (ImageObserver.observe output), engineResult (HandStateEngine.ingest output or null).
     */
    add(domain, truth, result, engineResult) {
      const m = this.d[domain]; if (!m) throw new Error('Unknown domain ' + domain); m.frames++;
      const reads = result.reads || { amounts: [], cards: [], markers: [] };
      // field-level scoring uses what the observer exposed even for frames it later rejected
      for (const r of reads.cards) { /* per-card truth alignment is by order within field */ }
      const okObs = result.ok, o = result.observation;
      if (okObs) {
        m.readable++;
        const cardsOk = eq(o.board, truth.board) && (!truth.hero.length || eq(o.seats[truth.heroSeat].cards, truth.hero));
        this._score(m.cat.card, cardsOk, true);
        this._score(m.cat.pot, o.pot === truth.pot, true);
        o.seats.forEach((s, i) => { this._score(m.cat.stack, s.stack === truth.stacks[i], true); this._score(m.cat.bet, s.bet === truth.bets[i], true); });
        const seatOk = o.button === truth.button && o.actor === truth.actor && o.hand === truth.hand && eq(o.seats.map((s) => s.folded), truth.folded); this._score(m.cat.seat, seatOk, true);
        const actOk = truth.complete || !truth.controls ? true : eq(o.controls, truth.controls) && (o.callAmount === undefined ? truth.callAmount === null : o.callAmount === truth.callAmount) && (o.minRaiseTo === undefined ? truth.minRaise === null : o.minRaiseTo === truth.minRaise); this._score(m.cat.action, actOk, true);
        const all = cardsOk && o.pot === truth.pot && o.seats.every((s, i) => s.stack === truth.stacks[i] && s.bet === truth.bets[i]) && seatOk && actOk;
        (all ? m.confidenceCorrect : m.confidenceWrong).push(o.confidence.overall);
        if (engineResult && engineResult.accepted) { m.accepted++; if (all) m.acceptedCorrect++; else m.falseAccepted++; }
        else { m.rejected++; const k = engineResult && engineResult.issues && engineResult.issues[0] ? engineResult.issues[0].code : 'not-ingested'; m.rejectReasons[k] = (m.rejectReasons[k] || 0) + 1; }
      } else {
        m.rejected++; const k = (result.reasons && result.reasons[0] || 'unreadable').split(':')[0].slice(0, 40); m.rejectReasons[k] = (m.rejectReasons[k] || 0) + 1;
        for (const c of CATS) { const n = c === 'stack' || c === 'bet' ? 8 : 1; m.cat[c].fields += n; m.cat[c].unread += n; }
      }
    }
    report() {
      const out = { format: 'eightmax-recognition-metrics', version: 1, domains: {} };
      for (const k of DOMAINS) {
        const m = this.d[k];
        if (!m.frames) { out.domains[k] = { frames: 0, status: k === 'real-client' ? 'not measured: no genuine authorised client screenshots were available' : 'not measured' }; continue; }
        const rate = (a, b) => (b ? a / b : null), cat = {};
        for (const c of CATS) { const x = m.cat[c]; cat[c] = { fields: x.fields, correct: x.correct, wrong: x.wrong, unread: x.unread, accuracyOfRead: rate(x.correct, x.correct + x.wrong), accuracyOverall: rate(x.correct, x.fields) }; }
        out.domains[k] = { frames: m.frames, readable: m.readable, accepted: m.accepted, rejected: m.rejected, acceptedStateAccuracy: rate(m.acceptedCorrect, m.accepted), falseAcceptanceRate: rate(m.falseAccepted, m.accepted), falseAcceptances: m.falseAccepted, rejectionRate: rate(m.rejected, m.frames), rejectReasons: { ...m.rejectReasons }, categories: cat,
          minConfidenceWhenCorrect: m.confidenceCorrect.length ? Math.min(...m.confidenceCorrect) : null, maxConfidenceWhenWrong: m.confidenceWrong.length ? Math.max(...m.confidenceWrong) : null };
      }
      return out;
    }
  }

  return { DOMAINS, CATS, truthFromTable, MetricsCollector };
});
